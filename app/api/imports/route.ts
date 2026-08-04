import { and, eq } from "drizzle-orm";
import { deleteStoredFile, ensureDatabase, getDb, putStoredFile } from "../../../db";
import { fileObjects, importDataBatches } from "../../../db/schema";
import { authErrorResponse, requireActiveMembership, requireAuthContext, requireRole, sha256 } from "../../../lib/auth";
import { materializeImportRows } from "../../../lib/import-materialization";
import { normalizeRows, parseWorkbook } from "../../../lib/import-parser";
import { normalizePlatformKey } from "../../../lib/platforms";
import type { ImportBatch } from "../../../lib/types";
import { filterWorkspaceForContext, getOrCreateGroupState, saveGroupState } from "../../../lib/workspace";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export async function GET(request: Request) {
  try {
    const context = await requireAuthContext(request);
    const active = requireActiveMembership(context);
    await ensureDatabase();
    const db = getDb();
    const rows = context.activeMembership?.role === "leader"
      ? await db.select().from(importDataBatches).where(eq(importDataBatches.groupId, active.groupId))
      : await db.select().from(importDataBatches).where(and(eq(importDataBatches.groupId, active.groupId), eq(importDataBatches.uploaderUserId, context.user.id)));
    return Response.json({ imports: rows.map((row) => ({ ...row, normalizedPayload: undefined })) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireAuthContext(request);
    const active = requireActiveMembership(context);
    const form = await request.formData();
    const file = form.get("file");
    const basis = form.get("basis");
    const metricType = form.get("metricType");
    const period = String(form.get("period") || "").slice(0, 50);
    if (!(file instanceof File)) return Response.json({ error: "请选择导入文件" }, { status: 400 });
    if (file.size <= 0 || file.size > MAX_IMPORT_BYTES) return Response.json({ error: "文件大小必须在10MB以内" }, { status: 400 });
    if (basis !== "内容累计表现" && basis !== "周期新增量") return Response.json({ error: "数据口径不正确" }, { status: 400 });
    if (metricType !== "自动识别" && metricType !== "曝光量" && metricType !== "播放量") return Response.json({ error: "分发指标类型不正确" }, { status: 400 });
    if (!period) return Response.json({ error: "缺少统计周期" }, { status: 400 });

    const workbook = await parseWorkbook(file);
    const current = await getOrCreateGroupState(active.groupId);
    const normalized = normalizeRows(workbook, metricType, current.platforms.filter((platform) => platform.active));
    if (!normalized.rows.length) return Response.json({ error: "没有识别到有效数据行" }, { status: 400 });

    await ensureDatabase();
    const db = getDb();
    const fileBuffer = await file.arrayBuffer();
    const fileId = `file_${crypto.randomUUID()}`;
    const batchId = `imp_${crypto.randomUUID()}`;
    const safeFilename = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120);
    const objectKey = `groups/${active.groupId}/imports/${batchId}/${safeFilename}`;
    const digest = await sha256(fileBuffer);
    await putStoredFile(objectKey, fileBuffer, {
      contentType: file.type || "application/octet-stream",
      metadata: { groupId: active.groupId, ownerUserId: context.user.id, sha256: digest },
    });

    await db.insert(fileObjects).values({
      id: fileId,
      groupId: active.groupId,
      ownerUserId: context.user.id,
      objectKey,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      sha256: digest,
    });
    await db.insert(importDataBatches).values({
      id: batchId,
      groupId: active.groupId,
      uploaderUserId: context.user.id,
      fileObjectId: fileId,
      period,
      basis,
      metricType,
      rowCount: normalized.rows.length,
      warningCount: normalized.warningCount,
      status: "pending",
      normalizedPayload: JSON.stringify({
        headers: workbook.headers,
        mapping: normalized.headerMapping,
        rows: normalized.rows,
        detectedPlatforms: normalized.detectedPlatforms,
        unmatchedPlatforms: normalized.unmatchedPlatforms,
      }),
    });

    const batch: ImportBatch = {
      id: batchId,
      filename: file.name,
      uploader: context.user.displayName,
      period,
      basis,
      metricType,
      rows: normalized.rows.length,
      warnings: normalized.warningCount,
      detectedPlatforms: normalized.detectedPlatforms,
      unmatchedPlatforms: normalized.unmatchedPlatforms,
      status: "待审核",
      createdAt: "刚刚",
    };
    const saved = await saveGroupState(context, current, { ...current, imports: [batch, ...current.imports] }, "上传并提交运营数据");
    if (!saved) return Response.json({ error: "工作区刚刚发生变化，请刷新后重试" }, { status: 409 });
    return Response.json({ batch, state: filterWorkspaceForContext(saved, context), sample: normalized.rows.slice(0, 5) }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const context = await requireAuthContext(request);
    const active = requireActiveMembership(context);
    requireRole(context, "leader");
    const body = await request.json() as { batchId?: string; action?: "approve" | "reject" | "revoke"; reason?: string };
    if (!body.batchId || !body.action) return Response.json({ error: "缺少审核参数" }, { status: 400 });
    await ensureDatabase();
    const db = getDb();
    const [batch] = await db.select().from(importDataBatches).where(and(
      eq(importDataBatches.id, body.batchId),
      eq(importDataBatches.groupId, active.groupId),
    )).limit(1);
    if (!batch) return Response.json({ error: "导入批次不存在" }, { status: 404 });
    const status = body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : "revoked";
    const current = await getOrCreateGroupState(active.groupId);
    let contentRows = current.contentRows.filter((row) => row.batchId !== batch.id);
    if (body.action === "approve") {
      const platformNames = new Map(current.platforms.flatMap((platform) => (
        [platform.name, ...platform.aliases].map((name) => [normalizePlatformKey(name), platform.name] as const)
      )));
      const rows = materializeImportRows(batch.id, batch.normalizedPayload, batch.basis as ImportBatch["basis"], batch.period);
      const unmatched = [...new Set(rows.map((row) => row.platform).filter((name) => !platformNames.has(normalizePlatformKey(name))))];
      if (unmatched.length) {
        return Response.json({ error: `无法批准：请先在平台管理中新增或匹配“${unmatched.join("、")}”` }, { status: 400 });
      }
      contentRows = [...contentRows, ...rows.map((row) => ({ ...row, platform: platformNames.get(normalizePlatformKey(row.platform)) || row.platform }))];
    }
    await db.update(importDataBatches).set({
      status,
      reviewedBy: context.user.id,
      reviewedAt: new Date().toISOString(),
      rejectReason: body.action === "reject" ? body.reason?.slice(0, 300) || "未填写原因" : null,
    }).where(eq(importDataBatches.id, batch.id));

    const displayStatus = status === "approved" ? "已批准" : status === "rejected" ? "已拒绝" : "已撤销";
    const saved = await saveGroupState(context, current, {
      ...current,
      contentRows,
      imports: current.imports.map((item) => item.id === batch.id ? { ...item, status: displayStatus as ImportBatch["status"] } : item),
    }, `审核运营数据：${displayStatus}`);
    return Response.json({ ok: true, state: saved });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireAuthContext(request);
    const active = requireActiveMembership(context);
    const url = new URL(request.url);
    const batchId = url.searchParams.get("batchId");
    if (!batchId) return Response.json({ error: "缺少 batchId" }, { status: 400 });

    await ensureDatabase();
    const db = getDb();
    const [batch] = await db.select().from(importDataBatches).where(and(
      eq(importDataBatches.id, batchId),
      eq(importDataBatches.groupId, active.groupId),
    )).limit(1);
    if (!batch) return Response.json({ error: "导入批次不存在" }, { status: 404 });

    // Leader 可删任何，实习生只能删自己待审核的
    if (context.activeMembership?.role !== "leader") {
      if (batch.uploaderUserId !== context.user.id) {
        return Response.json({ error: "只能删除自己上传的数据" }, { status: 403 });
      }
      if (batch.status !== "pending") {
        return Response.json({ error: "已审核的数据只能由 Leader 删除" }, { status: 403 });
      }
    }

    // 删除数据库记录和文件
    await db.delete(importDataBatches).where(eq(importDataBatches.id, batchId));
    const [fileRecord] = await db.select().from(fileObjects).where(eq(fileObjects.id, batch.fileObjectId)).limit(1);
    if (fileRecord) {
      await db.delete(fileObjects).where(eq(fileObjects.id, batch.fileObjectId));
      await deleteStoredFile(fileRecord.objectKey).catch(() => {});
    }

    // 更新工作区：移除导入记录和对应的 contentRows
    const current = await getOrCreateGroupState(active.groupId);
    const saved = await saveGroupState(context, current, {
      ...current,
      imports: current.imports.filter((item) => item.id !== batchId),
      contentRows: current.contentRows.filter((row) => row.batchId !== batchId),
    }, "删除导入数据");

    return Response.json({ ok: true, state: saved ? filterWorkspaceForContext(saved, context) : current });
  } catch (error) {
    return authErrorResponse(error);
  }
}
