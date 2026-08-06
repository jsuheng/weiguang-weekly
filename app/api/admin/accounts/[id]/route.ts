import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { activityEvents, groupMemberships, groupWorkspaceStates, sessions, users } from "../../../../../db/schema";
import {
  authErrorResponse,
  generateTemporaryPassword,
  hashPassword,
  requireActiveMembership,
  requireAuthContext,
  requireRole,
} from "../../../../../lib/auth";
import type { WorkspaceState } from "../../../../../lib/types";
import { upgradeWorkspaceState } from "../../../../../lib/workspace";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireAuthContext(request);
    const active = requireActiveMembership(context);
    requireRole(context, "leader");
    const { id } = await params;
    const body = await request.json() as { action?: "disable" | "enable" | "reset_password" | "delete" };
    if (!body.action) return Response.json({ error: "缺少账号操作" }, { status: 400 });
    if (id === context.user.id && body.action !== "enable") {
      return Response.json({ error: "不能在成员管理中停用、删除或重置自己的账号" }, { status: 403 });
    }

    const db = getDb();
    const [target] = await db.select({
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      role: groupMemberships.role,
      membershipId: groupMemberships.id,
    }).from(groupMemberships)
      .innerJoin(users, eq(groupMemberships.userId, users.id))
      .where(and(eq(groupMemberships.groupId, active.groupId), eq(users.id, id)))
      .limit(1);
    if (!target) return Response.json({ error: "成员账号不存在" }, { status: 404 });

    // 删除操作只允许对已停用/已离开的账号执行
    if (body.action === "delete") {
      const [membership] = await db.select({ status: groupMemberships.status }).from(groupMemberships)
        .where(eq(groupMemberships.id, target.membershipId)).limit(1);
      if (membership && membership.status === "active") {
        return Response.json({ error: "请先停用该成员后再删除" }, { status: 400 });
      }
    }

    if ((body.action === "disable" || body.action === "delete") && target.role === "leader") {
      const leaders = await db.select({ id: groupMemberships.id }).from(groupMemberships).where(and(
        eq(groupMemberships.groupId, active.groupId),
        eq(groupMemberships.role, "leader"),
        eq(groupMemberships.status, "active"),
        ne(groupMemberships.userId, target.userId),
      ));
      if (!leaders.length) return Response.json({ error: body.action === "delete" ? "不能删除最后一个有效 Leader" : "不能停用最后一个有效 Leader" }, { status: 409 });
    }

    let temporaryPassword: string | undefined;
    await db.transaction(async (transaction) => {
      if (body.action === "reset_password") {
        temporaryPassword = generateTemporaryPassword();
        await transaction.update(users).set({
          passwordHash: await hashPassword(temporaryPassword),
          mustChangePassword: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        }).where(eq(users.id, target.userId));
        await transaction.delete(sessions).where(eq(sessions.userId, target.userId));
      } else if (body.action === "delete") {
        // 永久删除：移除小组成员关系、清理工作区数据
        await transaction.delete(groupMemberships).where(eq(groupMemberships.id, target.membershipId));
        await transaction.delete(sessions).where(eq(sessions.userId, target.userId));

        // 检查该用户是否还有其他小组的成员关系
        const [otherMembership] = await transaction.select({ id: groupMemberships.id })
          .from(groupMemberships).where(eq(groupMemberships.userId, target.userId)).limit(1);
        if (!otherMembership) {
          await transaction.delete(users).where(eq(users.id, target.userId));
        }

        const [workspace] = await transaction.select().from(groupWorkspaceStates).where(eq(groupWorkspaceStates.groupId, active.groupId)).limit(1);
        if (workspace) {
          const state = upgradeWorkspaceState({ ...JSON.parse(workspace.payload), version: workspace.version } as WorkspaceState);
          const nextState = {
            ...state,
            version: workspace.version + 1,
            members: state.members.filter((member) => member.id !== target.membershipId),
            reports: state.reports.filter((report) => report.memberId !== target.membershipId),
            tasks: state.tasks.map((task) => task.assignee === target.displayName && task.status !== "已完成" ? { ...task, status: "待转交" as const } : task),
          };
          await transaction.update(groupWorkspaceStates).set({
            version: nextState.version,
            payload: JSON.stringify(nextState),
            updatedAt: sql`CURRENT_TIMESTAMP`,
          }).where(eq(groupWorkspaceStates.groupId, active.groupId));
        }
      } else {
        const enabled = body.action === "enable";
        await transaction.update(users).set({
          status: enabled ? "active" : "disabled",
          updatedAt: sql`CURRENT_TIMESTAMP`,
        }).where(eq(users.id, target.userId));
        await transaction.update(groupMemberships).set({
          status: enabled ? "active" : "left",
          updatedAt: sql`CURRENT_TIMESTAMP`,
        }).where(eq(groupMemberships.id, target.membershipId));
        if (!enabled) await transaction.delete(sessions).where(eq(sessions.userId, target.userId));

        const [workspace] = await transaction.select().from(groupWorkspaceStates).where(eq(groupWorkspaceStates.groupId, active.groupId)).limit(1);
        if (workspace) {
          const state = upgradeWorkspaceState({ ...JSON.parse(workspace.payload), version: workspace.version } as WorkspaceState);
          const nextState = {
            ...state,
            version: workspace.version + 1,
            members: state.members.map((member) => member.id === target.membershipId ? { ...member, status: enabled ? "active" as const : "left" as const } : member),
            tasks: enabled ? state.tasks : state.tasks.map((task) => task.assignee === target.displayName && task.status !== "已完成" ? { ...task, status: "待转交" as const } : task),
          };
          await transaction.update(groupWorkspaceStates).set({
            version: nextState.version,
            payload: JSON.stringify(nextState),
            updatedAt: sql`CURRENT_TIMESTAMP`,
          }).where(eq(groupWorkspaceStates.groupId, active.groupId));
        }
      }
      await transaction.insert(activityEvents).values({
        id: `evt_${crypto.randomUUID()}`,
        groupId: active.groupId,
        userId: context.user.id,
        actorName: context.user.displayName,
        action: body.action === "reset_password" ? "重置成员密码" : body.action === "enable" ? "启用成员账号" : body.action === "delete" ? "删除成员账号" : "停用成员账号",
        target: target.displayName,
      });
    });
    return Response.json({ ok: true, temporaryPassword });
  } catch (error) {
    return authErrorResponse(error);
  }
}
