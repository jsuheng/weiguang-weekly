import { eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../db";
import { importDataBatches } from "../../../db/schema";
import { authErrorResponse, requireActiveMembership, requireAuthContext } from "../../../lib/auth";
import { materializeImportRows } from "../../../lib/import-materialization";
import { normalizePlatformKey } from "../../../lib/platforms";
import type { ContentDataRow, ImportBatch, WorkspaceState } from "../../../lib/types";
import { filterWorkspaceForContext, getOrCreateGroupState, saveGroupState, syncMembershipsFromWorkspace, validateInternWorkspaceMutation } from "../../../lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requireAuthContext(request);
    const membership = requireActiveMembership(context);
    const state = await getOrCreateGroupState(membership.groupId);
    return Response.json({ state: filterWorkspaceForContext(state, context), context });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const context = await requireAuthContext(request);
    const membership = requireActiveMembership(context);
    const incoming = (await request.json()) as { state?: WorkspaceState; action?: string };
    if (!incoming.state || !Number.isInteger(incoming.state.version)) {
      return Response.json({ error: "缺少有效版本号" }, { status: 400 });
    }
    const current = await getOrCreateGroupState(membership.groupId);
    if (incoming.state.version !== current.version) {
      return Response.json({ error: "数据已被其他成员更新", state: filterWorkspaceForContext(current, context) }, { status: 409 });
    }

    if (membership.role === "intern") {
      const validationError = validateInternWorkspaceMutation(
        filterWorkspaceForContext(current, context),
        incoming.state,
        context.user.displayName,
      );
      if (validationError) return Response.json({ error: validationError }, { status: 403 });
      incoming.state = mergeInternChanges(current, incoming.state, context.user.displayName);
    }

    if (membership.role === "leader") {
      const reconciliation = await reconcileApprovedImports(membership.groupId, incoming.state);
      if (reconciliation.error) return Response.json({ error: reconciliation.error }, { status: 400 });
      incoming.state = { ...incoming.state, contentRows: reconciliation.contentRows };
    }

    const saved = await saveGroupState(context, current, incoming.state, incoming.action || "更新工作区");
    if (!saved) {
      const fresh = await getOrCreateGroupState(membership.groupId);
      return Response.json({ error: "数据已被其他成员更新", state: filterWorkspaceForContext(fresh, context) }, { status: 409 });
    }
    if (membership.role === "leader") await syncMembershipsFromWorkspace(membership.groupId, saved);
    return Response.json({ state: filterWorkspaceForContext(saved, context) });
  } catch (error) {
    return authErrorResponse(error);
  }
}

async function reconcileApprovedImports(groupId: string, incoming: WorkspaceState) {
  await ensureDatabase();
  const db = getDb();
  const storedBatches = await db.select().from(importDataBatches).where(eq(importDataBatches.groupId, groupId));
  const storedBatchIds = new Set(storedBatches.map((batch) => batch.id));
  const retainedRows = incoming.contentRows.filter((row) => !row.batchId || !storedBatchIds.has(row.batchId));
  const approved = new Map(incoming.imports.filter((batch) => batch.status === "已批准").map((batch) => [batch.id, batch]));
  const platformNames = new Map(incoming.platforms.flatMap((platform) => (
    [platform.name, ...platform.aliases].map((name) => [normalizePlatformKey(name), platform.name] as const)
  )));
  const importedRows: ContentDataRow[] = [];

  for (const stored of storedBatches) {
    const batch = approved.get(stored.id);
    if (!batch) continue;
    const rows = materializeImportRows(stored.id, stored.normalizedPayload, stored.basis as ImportBatch["basis"], stored.period);
    const unmatched = [...new Set(rows.map((row) => row.platform).filter((name) => !platformNames.has(normalizePlatformKey(name))))];
    if (unmatched.length) {
      return {
        contentRows: incoming.contentRows,
        error: `无法批准：平台“${unmatched.join("、")}”尚未匹配。请先在“平台管理”中新增平台或设置别名。`,
      };
    }
    importedRows.push(...rows.map((row) => ({ ...row, platform: platformNames.get(normalizePlatformKey(row.platform)) || row.platform })));
  }
  return { contentRows: [...retainedRows, ...importedRows], error: null };
}

function mergeInternChanges(full: WorkspaceState, visible: WorkspaceState, memberName: string): WorkspaceState {
  const taskMap = new Map(visible.tasks.map((item) => [item.id, item]));
  const reportMap = new Map(visible.reports.map((item) => [item.id, item]));
  const notificationMap = new Map(visible.notifications.map((item) => [item.id, item]));
  const existingImports = new Set(full.imports.map((item) => item.id));
  return {
    ...full,
    version: full.version,
    tasks: full.tasks.map((item) => item.assignee === memberName ? taskMap.get(item.id) || item : item),
    reports: full.reports.map((item) => item.memberName === memberName ? reportMap.get(item.id) || item : item),
    imports: [...visible.imports.filter((item) => !existingImports.has(item.id)), ...full.imports],
    notifications: full.notifications.map((item) => notificationMap.get(item.id) || item),
  };
}
