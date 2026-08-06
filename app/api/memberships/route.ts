import { and, eq, sql } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../db";
import { activityEvents, groupMemberships, groups, groupWorkspaceStates, users } from "../../../db/schema";
import { authErrorResponse, requireActiveMembership, requireAuthContext, requireRole } from "../../../lib/auth";
import type { Member, WorkspaceState } from "../../../lib/types";
import { upgradeWorkspaceState } from "../../../lib/workspace";

export async function GET(request: Request) {
  try {
    const context = await requireAuthContext(request);
    const active = requireActiveMembership(context);
    requireRole(context, "leader");
    await ensureDatabase();
    const rows = await getDb().select({
      id: groupMemberships.id,
      userId: users.id,
      name: users.displayName,
      username: users.username,
      role: groupMemberships.role,
      status: groupMemberships.status,
      note: groupMemberships.note,
      joinedAt: groupMemberships.joinedAt,
    }).from(groupMemberships)
      .innerJoin(users, eq(groupMemberships.userId, users.id))
      .where(eq(groupMemberships.groupId, active.groupId));
    return Response.json({ members: rows });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireAuthContext(request);
    const body = await request.json() as {
      membershipId?: string;
      action?: "approve" | "reject" | "remove" | "join";
      groupId?: string;
      role?: "leader" | "intern";
      note?: string;
    };

    // 入组申请：任何已验证用户均可发起，创建 pending 成员关系
    if (body.action === "join") {
      if (!body.groupId) return Response.json({ error: "缺少小组编号" }, { status: 400 });

      await ensureDatabase();
      const db = getDb();

      // 检查目标小组是否存在
      const [group] = await db.select({ id: groups.id, name: groups.name, ownerUserId: groups.ownerUserId })
        .from(groups).where(eq(groups.id, body.groupId)).limit(1);
      if (!group) return Response.json({ error: "小组不存在" }, { status: 404 });

      // 检查是否已有活跃或待审核的成员关系
      const [existing] = await db.select({ id: groupMemberships.id, status: groupMemberships.status })
        .from(groupMemberships)
        .where(and(
          eq(groupMemberships.groupId, body.groupId),
          eq(groupMemberships.userId, context.user.id),
        ))
        .limit(1);
      if (existing && (existing.status === "active" || existing.status === "pending")) {
        return Response.json({ error: existing.status === "active" ? "你已经是该小组成员" : "你已经提交过入组申请，请等待审核" }, { status: 409 });
      }

      const membershipId = `gm_${crypto.randomUUID()}`;
      const requestedRole = body.role === "leader" ? "leader" : "intern";
      const note = body.note?.trim().slice(0, 200) || null;

      await db.insert(groupMemberships).values({
        id: membershipId,
        groupId: body.groupId,
        userId: context.user.id,
        role: requestedRole,
        status: "pending",
        note,
      });

      await db.insert(activityEvents).values({
        id: `evt_${crypto.randomUUID()}`,
        groupId: body.groupId,
        userId: context.user.id,
        actorName: context.user.displayName,
        action: "申请加入小组",
        target: group.name,
        metadata: JSON.stringify({ role: requestedRole, note }),
      });

      return Response.json({ ok: true, membershipId, status: "pending" }, { status: 201 });
    }

    // 审批/拒绝/移除：需要 Leader 权限
    const active = requireActiveMembership(context);
    requireRole(context, "leader");
    if (!body.membershipId || !body.action) return Response.json({ error: "缺少审批参数" }, { status: 400 });

    await ensureDatabase();
    const db = getDb();
    const [target] = await db.select().from(groupMemberships).where(and(
      eq(groupMemberships.id, body.membershipId),
      eq(groupMemberships.groupId, active.groupId),
    )).limit(1);
    if (!target) return Response.json({ error: "成员关系不存在" }, { status: 404 });
    if (target.role === "leader" && body.action === "remove") {
      return Response.json({ error: "不能移除小组所有者" }, { status: 403 });
    }

    const status = body.action === "approve" ? "active" : body.action === "reject" ? "rejected" : "left";

    await db.transaction(async (transaction) => {
      await transaction.update(groupMemberships).set({
        status,
        joinedAt: body.action === "approve" ? new Date().toISOString().slice(0, 10) : target.joinedAt,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }).where(eq(groupMemberships.id, target.id));

      // 批准入组申请时，同步更新工作区状态
      if (body.action === "approve") {
        const [workspace] = await transaction.select().from(groupWorkspaceStates)
          .where(eq(groupWorkspaceStates.groupId, active.groupId)).limit(1);
        if (workspace) {
          const state = upgradeWorkspaceState({
            ...JSON.parse(workspace.payload),
            version: workspace.version,
          } as WorkspaceState);
          const [user] = await transaction.select({ displayName: users.displayName })
            .from(users).where(eq(users.id, target.userId)).limit(1);
          const displayName = user?.displayName || "未知";
          const member: Member = {
            id: target.id,
            name: displayName,
            role: target.role,
            status: "active",
            initials: displayName.slice(0, 1),
            color: target.role === "leader" ? "#173f3a" : "#6389a8",
            joinedAt: new Date().toISOString().slice(0, 10),
          };
          const nextState = {
            ...state,
            version: workspace.version + 1,
            members: state.members.some((m) => m.id === target.id)
              ? state.members.map((m) => m.id === target.id ? member : m)
              : [...state.members, member],
          };
          await transaction.update(groupWorkspaceStates).set({
            version: nextState.version,
            payload: JSON.stringify(nextState),
            updatedAt: sql`CURRENT_TIMESTAMP`,
          }).where(and(
            eq(groupWorkspaceStates.groupId, active.groupId),
            eq(groupWorkspaceStates.version, workspace.version),
          ));
        }
      }
    });

    await db.insert(activityEvents).values({
      id: `evt_${crypto.randomUUID()}`,
      groupId: active.groupId,
      userId: context.user.id,
      actorName: context.user.displayName,
      action: body.action === "approve" ? "批准入组申请" : body.action === "reject" ? "拒绝入组申请" : "移除成员",
      target: target.userId,
    });

    return Response.json({ ok: true, status });
  } catch (error) {
    return authErrorResponse(error);
  }
}
