import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../../db";
import { groupMemberships, groups, groupWorkspaceStates, notificationJobs, users } from "../../../../../db/schema";
import type { Report, WorkspaceState } from "../../../../../lib/types";

export async function POST(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;
  const suppliedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!configuredSecret || suppliedSecret !== configuredSecret) {
    return Response.json({ error: "定时任务认证失败" }, { status: 401 });
  }

  await ensureDatabase();
  const db = getDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const workspaces = await db.select({
    groupId: groupWorkspaceStates.groupId,
    payload: groupWorkspaceStates.payload,
    groupName: groups.name,
    timezone: groups.timezone,
    workStart: groups.workStart,
    workEnd: groups.workEnd,
  }).from(groupWorkspaceStates).innerJoin(groups, eq(groupWorkspaceStates.groupId, groups.id));

  let created = 0;
  for (const workspace of workspaces) {
    const state = JSON.parse(workspace.payload) as WorkspaceState;
    const members = await db.select({
      userId: users.id,
      name: users.displayName,
      role: groupMemberships.role,
    }).from(groupMemberships)
      .innerJoin(users, eq(groupMemberships.userId, users.id))
      .where(and(eq(groupMemberships.groupId, workspace.groupId), eq(groupMemberships.status, "active")));
    const byName = new Map(members.map((member) => [member.name, member]));
    const leaders = members.filter((member) => member.role === "leader");

    for (const task of state.tasks) {
      const assignee = byName.get(task.assignee);
      if (!assignee || !task.dueAt || task.status === "已完成") continue;
      const due = new Date(task.dueAt);
      const minutesUntilDue = (due.getTime() - now.getTime()) / 60000;
      if (minutesUntilDue <= 0) {
        created += await queueJob(workspace.groupId, assignee.userId, "task_overdue", `任务逾期：${task.title}`, `${task.assignee}负责的任务已超过DDL。`, nowIso, `${task.id}:overdue:${dateKey(now)}`);
        for (const leader of leaders) {
          created += await queueJob(workspace.groupId, leader.userId, "task_overdue_leader", "成员任务已逾期", `${task.assignee}负责的「${task.title}」已逾期。`, nowIso, `${task.id}:leader-overdue:${leader.userId}:${dateKey(now)}`);
        }
      } else if (minutesUntilDue <= 120 && (task.priority === "重要" || task.priority === "紧急")) {
        created += await queueJob(workspace.groupId, assignee.userId, "task_due_soon", "任务即将到期", `「${task.title}」将在2小时内到期。`, nowIso, `${task.id}:due-soon`);
      }
    }

    created += await queueWeeklyReportReminders(workspace.groupId, state.reports, members, leaders, now, workspace.timezone);
  }

  return Response.json({ ok: true, created });
}

async function queueWeeklyReportReminders(
  groupId: string,
  reports: Report[],
  members: Array<{ userId: string; name: string; role: "leader" | "intern" }>,
  leaders: Array<{ userId: string; name: string; role: "leader" | "intern" }>,
  now: Date,
  timezone: string,
) {
  const parts = localParts(now, timezone);
  let slot: "fri-1000" | "fri-1700" | "fri-1830" | "fri-1900" | "mon-1000" | null = null;
  if (parts.weekday === "Fri" && parts.hour === 10 && parts.minute < 10) slot = "fri-1000";
  if (parts.weekday === "Fri" && parts.hour === 17 && parts.minute < 10) slot = "fri-1700";
  if (parts.weekday === "Fri" && parts.hour === 18 && parts.minute >= 30 && parts.minute < 40) slot = "fri-1830";
  if (parts.weekday === "Fri" && parts.hour === 19 && parts.minute < 10) slot = "fri-1900";
  if (parts.weekday === "Mon" && parts.hour === 10 && parts.minute < 10) slot = "mon-1000";
  if (!slot) return 0;
  let created = 0;
  if (slot === "mon-1000") {
    for (const leader of leaders) {
      created += await queueJob(groupId, leader.userId, "weekly_report_summary", "上周周报汇总", `共${reports.length}份周报，请查看提交与点评情况。`, now.toISOString(), `${groupId}:${slot}:${dateKey(now)}:${leader.userId}`);
    }
    return created;
  }
  for (const member of members.filter((item) => item.role === "intern")) {
    const report = reports.find((item) => item.memberName === member.name);
    if (report?.status === "已提交" || report?.status === "已点评") continue;
    const title = slot === "fri-1900" ? "周报已截止" : "周报提交提醒";
    const detail = slot === "fri-1000" ? "今天19:00截止，请安排时间完成。" : slot === "fri-1700" ? "距离截止还有2小时。" : slot === "fri-1830" ? "距离截止还有30分钟。" : "当前提交将标记为迟交。";
    created += await queueJob(groupId, member.userId, `report_${slot}`, title, detail, now.toISOString(), `${groupId}:${slot}:${dateKey(now)}:${member.userId}`);
  }
  return created;
}

async function queueJob(groupId: string, userId: string, kind: string, title: string, detail: string, scheduledFor: string, dedupKey: string) {
  const result = await getDb().insert(notificationJobs).values({
    id: `job_${crypto.randomUUID()}`,
    groupId,
    userId,
    kind,
    title,
    detail,
    scheduledFor,
    dedupKey,
    status: "sent",
    sentAt: scheduledFor,
  }).onConflictDoNothing().returning({ id: notificationJobs.id });
  return result.length;
}

function localParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return { weekday: parts.weekday, hour: Number(parts.hour), minute: Number(parts.minute) };
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
