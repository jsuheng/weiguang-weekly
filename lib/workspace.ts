import { and, eq, sql } from "drizzle-orm";
import { ensureDatabase, getDb } from "../db";
import { activityEvents, groupMemberships, groupWorkspaceStates, importDataBatches, users } from "../db/schema";
import type { AuthContext } from "./auth";
import type { ImportBatch, NotificationItem, Report, Task, WorkspaceState } from "./types";
import { mergePlatformDefaults } from "./platforms";

export async function getOrCreateGroupState(groupId: string): Promise<WorkspaceState> {
  await ensureDatabase();
  const db = getDb();
  const [existing] = await db.select().from(groupWorkspaceStates).where(eq(groupWorkspaceStates.groupId, groupId)).limit(1);
  if (existing) return upgradeWorkspaceState({ ...JSON.parse(existing.payload), version: existing.version } as WorkspaceState);
  const initial: WorkspaceState = {
    version: 1,
    platforms: mergePlatformDefaults(),
    contentRows: [],
    members: [],
    tasks: [],
    reports: [],
    imports: [],
    notifications: [],
  };
  await db.insert(groupWorkspaceStates).values({ groupId, version: 1, payload: JSON.stringify(initial) });
  return initial;
}

export function filterWorkspaceForContext(state: WorkspaceState, context: AuthContext): WorkspaceState {
  if (context.activeMembership?.role === "leader") return state;
  const name = context.user.displayName;
  return {
    ...state,
    members: state.members
      .filter((member) => member.status === "active"),
    tasks: state.tasks.filter((task) => task.assignee === name),
    reports: state.reports.filter((report) => report.memberName === name),
    imports: state.imports.filter((batch) => batch.uploader === name || batch.status === "已批准"),
    notifications: state.notifications.filter((item) => isRelevantNotification(item, name)),
  };
}

export function validateInternWorkspaceMutation(current: WorkspaceState, incoming: WorkspaceState, memberName: string) {
  if (incoming.version !== current.version) return "数据版本已经变化";
  if (!same(current.members, incoming.members)) return "实习生不能修改成员数据";
  if (!same(current.platforms, incoming.platforms)) return "只有 Leader 可以管理平台";
  if (!same(current.contentRows, incoming.contentRows)) return "正式账号数据只能由 Leader 审核后写入";

  const taskError = validateOwnedRecords(current.tasks, incoming.tasks, (currentTask, nextTask) => {
    if (currentTask.assignee !== memberName) return same(currentTask, nextTask);
    return same(omit(currentTask, ["status"]), omit(nextTask, ["status"]));
  });
  if (taskError) return "只能更新分配给自己的任务状态";

  const reportError = validateOwnedRecords(current.reports, incoming.reports, (currentReport, nextReport) => {
    if (currentReport.memberName !== memberName) return same(currentReport, nextReport);
    return currentReport.memberId === nextReport.memberId
      && currentReport.memberName === nextReport.memberName
      && currentReport.review === nextReport.review;
  });
  if (reportError) return "只能填写和提交自己的周报";

  if (!validateImportChanges(current.imports, incoming.imports, memberName)) {
    return "只能新增本人提交且状态为待审核的导入记录";
  }

  const notificationError = validateOwnedRecords(current.notifications, incoming.notifications, (currentItem, nextItem) => (
    same(omit(currentItem, ["read"]), omit(nextItem, ["read"]))
  ));
  if (notificationError) return "通知内容不可修改";
  return null;
}

export async function saveGroupState(context: AuthContext, current: WorkspaceState, incoming: WorkspaceState, action: string) {
  if (!context.activeMembership) throw new Error("当前没有可用小组");
  const db = getDb();
  const nextState = { ...incoming, version: current.version + 1 };
  const result = await db.update(groupWorkspaceStates)
    .set({ version: nextState.version, payload: JSON.stringify(nextState), updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(
      eq(groupWorkspaceStates.groupId, context.activeMembership.groupId),
      eq(groupWorkspaceStates.version, current.version),
    ))
    .returning({ version: groupWorkspaceStates.version });
  if (!result.length) return null;

  await db.insert(activityEvents).values({
    id: `evt_${crypto.randomUUID()}`,
    groupId: context.activeMembership.groupId,
    userId: context.user.id,
    actorName: context.user.displayName,
    action,
    target: context.activeMembership.groupName,
  });
  return nextState;
}

export async function syncMembershipsFromWorkspace(groupId: string, state: WorkspaceState) {
  const db = getDb();
  const rows = await db.select({
    membershipId: groupMemberships.id,
    name: users.displayName,
    role: groupMemberships.role,
  }).from(groupMemberships)
    .innerJoin(users, eq(groupMemberships.userId, users.id))
    .where(eq(groupMemberships.groupId, groupId));
  for (const row of rows) {
    if (row.role === "leader") continue;
    const member = state.members.find((item) => item.id === row.membershipId || item.name === row.name);
    if (!member) continue;
    const membershipStatus = member.status === "active" ? "active" : member.status === "left" ? "left" : "pending";
    await db.update(groupMemberships).set({
      status: membershipStatus,
      joinedAt: member.joinedAt || null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(groupMemberships.id, row.membershipId));
  }
  for (const batch of state.imports) {
    const status = batch.status === "已批准" ? "approved" : batch.status === "已拒绝" ? "rejected" : batch.status === "已撤销" ? "revoked" : "pending";
    await db.update(importDataBatches).set({ status }).where(and(
      eq(importDataBatches.id, batch.id),
      eq(importDataBatches.groupId, groupId),
    ));
  }
}

function validateOwnedRecords<T extends { id: string }>(current: T[], incoming: T[], validator: (currentItem: T, incomingItem: T) => boolean) {
  if (current.length !== incoming.length) return true;
  const incomingMap = new Map(incoming.map((item) => [item.id, item]));
  return current.some((item) => {
    const next = incomingMap.get(item.id);
    return !next || !validator(item, next);
  });
}

function validateImportChanges(current: ImportBatch[], incoming: ImportBatch[], memberName: string) {
  const currentMap = new Map(current.map((item) => [item.id, item]));
  if (incoming.length < current.length) return false;
  for (const item of incoming) {
    const existing = currentMap.get(item.id);
    if (existing && !same(existing, item)) return false;
    if (!existing && (item.uploader !== memberName || item.status !== "待审核")) return false;
  }
  return current.every((item) => incoming.some((next) => next.id === item.id));
}

function isRelevantNotification(item: NotificationItem, name: string) {
  return item.detail.includes(name);
}

function omit<T extends Record<string, unknown>>(value: T, keys: string[]) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export type WorkspaceMutationRecord = Task | Report | ImportBatch | NotificationItem;

export function upgradeWorkspaceState(state: WorkspaceState): WorkspaceState {
  return {
    ...state,
    platforms: mergePlatformDefaults(state.platforms),
    contentRows: Array.isArray(state.contentRows) ? state.contentRows : [],
    members: Array.isArray(state.members) ? state.members : [],
    tasks: Array.isArray(state.tasks) ? state.tasks : [],
    reports: Array.isArray(state.reports) ? state.reports : [],
    imports: Array.isArray(state.imports) ? state.imports : [],
    notifications: Array.isArray(state.notifications) ? state.notifications : [],
  };
}
