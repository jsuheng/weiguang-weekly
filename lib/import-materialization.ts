import type { NormalizedContentRow } from "./import-parser";
import type { ContentDataRow, ImportBatch } from "./types";

type StoredNormalizedPayload = {
  rows?: NormalizedContentRow[];
};

export function materializeImportRows(
  batchId: string,
  normalizedPayload: string,
  basis: ImportBatch["basis"],
  period: string,
): ContentDataRow[] {
  let payload: StoredNormalizedPayload;
  try {
    payload = JSON.parse(normalizedPayload) as StoredNormalizedPayload;
  } catch {
    return [];
  }
  if (!Array.isArray(payload.rows)) return [];
  return payload.rows.flatMap((row) => {
    if (!row.platform || !row.accountName || !row.title) return [];
    const distribution = row.impressions ?? row.plays ?? 0;
    const interactions = (row.likes ?? 0) + (row.comments ?? 0) + (row.saves ?? 0) + (row.shares ?? 0);
    const engagement = row.platformEngagementRate ?? (distribution > 0 ? Math.round((interactions / distribution) * 10000) / 100 : 0);
    return [{
      id: `${batchId}_${row.sourceRow}`,
      batchId,
      platform: row.platform,
      account: row.accountName,
      title: row.title,
      link: row.link,
      metricType: row.distributionMetricType,
      exposure: distribution,
      exit: row.twoSecondExitRate,
      five: row.fiveSecondCompletionRate,
      engage: engagement,
      likes: row.likes ?? 0,
      comments: row.comments ?? 0,
      saves: row.saves ?? 0,
      shares: row.shares ?? 0,
      complete: row.fullCompletionRate,
      followers: row.attributedFollowerGain ?? 0,
      basis,
      period,
    }];
  });
}
