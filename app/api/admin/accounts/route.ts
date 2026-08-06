import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { activityEvents, groupMemberships, groupWorkspaceStates, users } from "../../../../db/schema";
import {
  authErrorResponse,
  generateTemporaryPassword,
  hashPassword,
  normalizeUsername,
  requireActiveMembership,
  requireAuthContext,
  requireRole,
} from "../../../../lib/auth";
import type { Member, Report, WorkspaceState } from "../../../../lib/types";
import { upgradeWorkspaceState } from "../../../../lib/workspace";

export async function GET(request: Request) {
  try {
    const context = await requireAuthContext(request);
    const active = requireActiveMembership(context);
    requireRole(context, "leader");
    const rows = await getDb().select({
      id: users.id,
      membershipId: groupMemberships.id,
      username: users.username,
      displayName: users.displayName,
      role: groupMemberships.role,
      membershipStatus: groupMemberships.status,
      accountStatus: users.status,
      mustChangePassword: users.mustChangePassword,
      joinedAt: groupMemberships.joinedAt,
      note: groupMemberships.note,
    }).from(groupMemberships)
      .innerJoin(users, eq(groupMemberships.userId, users.id))
      .where(eq(groupMemberships.groupId, active.groupId));
    return Response.json({ accounts: rows });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireAuthContext(request);
    const active = requireActiveMembership(context);
    requireRole(context, "leader");
    const body = await request.json() as { username?: string; displayName?: string; role?: "leader" | "intern" };
    const username = normalizeUsername(body.username || "");
    const displayName = body.displayName?.trim().slice(0, 40);
    const role = body.role === "leader" ? "leader" : "intern";
    if (!username) return Response.json({ error: "用户名需为3—32位字母、数字、点、横线或下划线" }, { status: 400 });
    if (!displayName) return Response.json({ error: "请输入成员姓名" }, { status: 400 });

    const db = getDb();
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    if (existing) return Response.json({ error: "用户名已存在" }, { status: 409 });
    const [sameName] = await db.select({ id: users.id }).from(groupMemberships)
      .innerJoin(users, eq(groupMemberships.userId, users.id))
      .where(and(eq(groupMemberships.groupId, active.groupId), eq(users.displayName, displayName)))
      .limit(1);
    if (sameName) return Response.json({ error: "小组内成员姓名不能重复" }, { status: 409 });
    const temporaryPassword = generateTemporaryPassword();
    const userId = `usr_${crypto.randomUUID()}`;
    const membershipId = `gm_${crypto.randomUUID()}`;
    const joinedAt = new Date().toISOString().slice(0, 10);
    const color = role === "leader" ? "#173f3a" : "#6389a8";

    await db.transaction(async (transaction) => {
      const [workspace] = await transaction.select().from(groupWorkspaceStates).where(eq(groupWorkspaceStates.groupId, active.groupId)).limit(1);
      if (!workspace) throw new Error("工作空间尚未初始化");
      const state = upgradeWorkspaceState({ ...JSON.parse(workspace.payload), version: workspace.version } as WorkspaceState);
      const member: Member = {
        id: membershipId,
        name: displayName,
        role,
        status: "active",
        initials: displayName.slice(0, 1),
        color,
        joinedAt,
      };
      const report: Report = {
        id: `report_${membershipId}`,
        memberId: membershipId,
        memberName: displayName,
        status: "草稿",
        progress: 0,
        updatedAt: "刚刚",
        completed: "",
        result: "",
        blockers: "",
        next: "",
      };
      const nextState = {
        ...state,
        version: workspace.version + 1,
        members: [...state.members, member],
        reports: role === "intern" ? [...state.reports, report] : state.reports,
      };
      await transaction.insert(users).values({
        id: userId,
        username,
        displayName,
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
      });
      await transaction.insert(groupMemberships).values({
        id: membershipId,
        groupId: active.groupId,
        userId,
        role,
        status: "active",
        joinedAt,
      });
      await transaction.update(groupWorkspaceStates).set({
        version: nextState.version,
        payload: JSON.stringify(nextState),
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }).where(and(eq(groupWorkspaceStates.groupId, active.groupId), eq(groupWorkspaceStates.version, workspace.version)));
      await transaction.insert(activityEvents).values({
        id: `evt_${crypto.randomUUID()}`,
        groupId: active.groupId,
        userId: context.user.id,
        actorName: context.user.displayName,
        action: `创建${role === "leader" ? "Leader" : "实习生"}账号`,
        target: displayName,
      });
    });
    return Response.json({ id: userId, username, displayName, role, temporaryPassword }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
