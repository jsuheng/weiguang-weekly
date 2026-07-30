import type { PlatformDefinition } from "./types";
import { normalizePlatformKey } from "./platforms";

export type ParsedWorkbook = {
  headers: string[];
  rows: Array<Record<string, string | number | null>>;
};

export type NormalizedContentRow = {
  sourceRow: number;
  platform: string | null;
  accountName: string | null;
  title: string | null;
  summary: string | null;
  link: string | null;
  distributionMetricType: "曝光量" | "播放量";
  impressions: number | null;
  plays: number | null;
  twoSecondExitRate: number | null;
  fiveSecondCompletionRate: number | null;
  platformEngagementRate: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  fullCompletionRate: number | null;
  attributedFollowerGain: number | null;
  warnings: string[];
};

const HEADER_ALIASES = {
  platform: ["平台"],
  account: ["账号名", "账号名称", "账号"],
  content: ["发布内容", "内容", "内容标题", "标题"],
  distribution: ["曝光数｜播放量", "曝光数|播放量", "曝光数", "曝光量", "播放量", "分发量"],
  exit: ["2秒退出率", "2s退出率", "2秒跳出率"],
  five: ["5秒完播", "5秒完播率"],
  engagement: ["互动率"],
  likes: ["点赞数", "点赞"],
  comments: ["评论数", "评论"],
  saves: ["收藏数", "收藏"],
  shares: ["分享数", "分享", "转发数"],
  full: ["全篇完播率", "完播率"],
  followers: ["涨粉数", "内容归因涨粉", "归因涨粉"],
} as const;

export async function parseWorkbook(file: File): Promise<ParsedWorkbook> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".csv") || file.type.includes("csv")) return parseCsv(new TextDecoder().decode(bytes));
  if (lowerName.endsWith(".xlsx")) return parseXlsx(bytes);
  throw new Error("仅支持 .xlsx 和 .csv 文件；旧版 .xls 请先另存为 .xlsx");
}

export function normalizeRows(
  workbook: ParsedWorkbook,
  metricType: "自动识别" | "曝光量" | "播放量",
  platformDefinitions: PlatformDefinition[] = [],
) {
  const resolved = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([key, aliases]) => [
    key,
    aliases.find((alias) => workbook.headers.some((header) => normalizeHeader(header) === normalizeHeader(alias))) || null,
  ])) as Record<keyof typeof HEADER_ALIASES, string | null>;

  const missingRequired = [
    !resolved.platform && "平台",
    !resolved.account && "账号名",
    !resolved.content && "发布内容",
    !resolved.distribution && "曝光量/播放量",
  ].filter(Boolean) as string[];
  if (missingRequired.length) throw new Error(`缺少必要字段：${missingRequired.join("、")}`);

  const rows = workbook.rows.map((source, index): NormalizedContentRow => {
    const content = nullableText(readValue(source, resolved.content));
    const link = content?.match(/https?:\/\/[^\s]+/)?.[0]?.replace(/[),，。]+$/, "") || null;
    const textWithoutLink = content?.replace(/https?:\/\/[^\s]+/, "").trim() || null;
    const title = textWithoutLink?.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
    const warnings: string[] = [];
    const rawPlatform = nullableText(readValue(source, resolved.platform));
    const matchedPlatform = matchPlatform(rawPlatform, link, platformDefinitions);
    const platform = matchedPlatform?.name || rawPlatform;
    const accountName = nullableText(readValue(source, resolved.account));
    const rowMetricType = metricType === "自动识别"
      ? matchedPlatform?.metricType || inferMetricType(resolved.distribution)
      : metricType;
    const distribution = nonNegativeInteger(readValue(source, resolved.distribution), "分发量", warnings);
    if (!platform) warnings.push("缺少平台");
    if (rawPlatform && !matchedPlatform && platformDefinitions.length) warnings.push(`未匹配平台“${rawPlatform}”，请 Leader 新增平台或配置别名`);
    if (!rawPlatform && matchedPlatform) warnings.push(`已根据链接自动识别为${matchedPlatform.name}`);
    if (!accountName) warnings.push("缺少账号名");
    if (!title) warnings.push("缺少内容标题");
    if (distribution === null) warnings.push(`缺少${rowMetricType}`);
    if (link && matchedPlatform && !linkMatchesPlatform(link, matchedPlatform)) warnings.push("内容链接可能与平台不匹配");

    return {
      sourceRow: index + 2,
      platform,
      accountName,
      title,
      summary: textWithoutLink,
      link,
      distributionMetricType: rowMetricType,
      impressions: rowMetricType === "曝光量" ? distribution : null,
      plays: rowMetricType === "播放量" ? distribution : null,
      twoSecondExitRate: percentage(readValue(source, resolved.exit), "2秒退出率", warnings),
      fiveSecondCompletionRate: percentage(readValue(source, resolved.five), "5秒完播率", warnings),
      platformEngagementRate: percentage(readValue(source, resolved.engagement), "互动率", warnings),
      likes: nonNegativeInteger(readValue(source, resolved.likes), "点赞数", warnings),
      comments: nonNegativeInteger(readValue(source, resolved.comments), "评论数", warnings),
      saves: nonNegativeInteger(readValue(source, resolved.saves), "收藏数", warnings),
      shares: nonNegativeInteger(readValue(source, resolved.shares), "分享数", warnings),
      fullCompletionRate: percentage(readValue(source, resolved.full), "全篇完播率", warnings),
      attributedFollowerGain: nonNegativeInteger(readValue(source, resolved.followers), "涨粉数", warnings),
      warnings,
    };
  }).filter((row) => row.platform || row.accountName || row.title);

  return {
    rows,
    warningCount: rows.reduce((sum, row) => sum + row.warnings.length, 0),
    headerMapping: resolved,
    detectedPlatforms: [...new Set(rows.map((row) => row.platform).filter((value): value is string => Boolean(value && matchPlatform(value, null, platformDefinitions))))],
    unmatchedPlatforms: [...new Set(rows.map((row) => row.platform).filter((value): value is string => Boolean(value && !matchPlatform(value, null, platformDefinitions))))],
  };
}

function parseCsv(text: string): ParsedWorkbook {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) records.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) records.push(row);
  return rowsToWorkbook(records);
}

async function parseXlsx(bytes: Uint8Array): Promise<ParsedWorkbook> {
  const files = await unzip(bytes);
  const sharedStringsXml = files.get("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsXml ? parseSharedStrings(new TextDecoder().decode(sharedStringsXml)) : [];
  const sheetName = [...files.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()[0];
  if (!sheetName) throw new Error("Excel 文件中未找到可读取的工作表");
  const sheetXml = new TextDecoder().decode(files.get(sheetName)!);
  const records: Array<Array<string | number | null>> = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const record: Array<string | number | null> = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2];
      const reference = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1] || "A";
      const column = columnIndex(reference);
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? "";
      let value: string | number | null = decodeXml(raw);
      if (type === "s") value = sharedStrings[Number(raw)] ?? "";
      else if (type !== "inlineStr" && raw !== "" && Number.isFinite(Number(raw))) value = Number(raw);
      record[column] = value;
    }
    if (record.some((cell) => cell !== null && cell !== undefined && String(cell).trim())) records.push(record);
  }
  return rowsToWorkbook(records);
}

function rowsToWorkbook(records: Array<Array<string | number | null>>): ParsedWorkbook {
  if (!records.length) throw new Error("文件中没有可导入的数据");
  const headers = records[0].map((cell) => String(cell ?? "").trim());
  const rows = records.slice(1).map((record) => Object.fromEntries(headers.map((header, index) => [header, normalizeCell(record[index])]))).filter((record) => Object.values(record).some((value) => value !== null));
  return { headers, rows };
}

async function unzip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error("Excel 文件结构损坏");
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Excel 压缩目录损坏");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const filename = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    if (!filename.endsWith("/")) {
      if (method === 0) files.set(filename, compressed.slice());
      else if (method === 8) files.set(filename, await inflateRaw(compressed));
      else throw new Error(`Excel 使用了不支持的压缩方式：${method}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

async function inflateRaw(bytes: Uint8Array) {
  const stableBuffer = bytes.slice().buffer;
  const stream = new Blob([stableBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function parseSharedStrings(xml: string) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => (
    [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((item) => decodeXml(item[1])).join("")
  ));
}

function columnIndex(letters: string) {
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function decodeXml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || ["-", "—", "不适用", "N/A", "n/a"].includes(trimmed)) return null;
    return trimmed;
  }
  return value;
}

function readValue(source: Record<string, string | number | null>, resolvedHeader: string | null) {
  if (!resolvedHeader) return null;
  const actual = Object.keys(source).find((header) => normalizeHeader(header) === normalizeHeader(resolvedHeader));
  return actual ? source[actual] : null;
}

function normalizeHeader(value: string) {
  return value.replace(/\s+/g, "").replace(/[|｜]/g, "｜").toLowerCase();
}

function nullableText(value: unknown) {
  const normalized = normalizeCell(value as string | number | null);
  return normalized === null ? null : String(normalized);
}

function nonNegativeInteger(value: unknown, label: string, warnings: string[]) {
  const normalized = normalizeCell(value as string | number | null);
  if (normalized === null) return null;
  const number = Number(String(normalized).replace(/,/g, ""));
  if (!Number.isInteger(number) || number < 0) {
    warnings.push(`${label}不是非负整数`);
    return null;
  }
  return number;
}

function percentage(value: unknown, label: string, warnings: string[]) {
  const normalized = normalizeCell(value as string | number | null);
  if (normalized === null) return null;
  const text = String(normalized).replace("%", "").trim();
  let number = Number(text);
  if (!String(normalized).includes("%") && number >= 0 && number <= 1) number *= 100;
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    warnings.push(`${label}超出0%—100%`);
    return null;
  }
  return Math.round(number * 100) / 100;
}

function matchPlatform(rawPlatform: string | null, link: string | null, definitions: PlatformDefinition[]) {
  if (rawPlatform) {
    const key = normalizePlatformKey(rawPlatform);
    const direct = definitions.find((platform) => (
      normalizePlatformKey(platform.name) === key
      || platform.aliases.some((alias) => normalizePlatformKey(alias) === key)
    ));
    if (direct) return direct;
  }
  if (!rawPlatform && link) {
    try {
      const host = new URL(link).hostname.toLowerCase();
      return definitions.find((platform) => platform.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function inferMetricType(distributionHeader: string | null): "曝光量" | "播放量" {
  return distributionHeader?.includes("播放") ? "播放量" : "曝光量";
}

function linkMatchesPlatform(link: string, platform: PlatformDefinition) {
  if (!platform.domains.length) return true;
  try {
    const host = new URL(link).hostname.toLowerCase();
    return platform.domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
