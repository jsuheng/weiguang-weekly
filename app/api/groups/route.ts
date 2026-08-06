import { and, eq, ne, or, sql } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../db";
import { activityEvents, groupMemberships, groups, groupWorkspaceStates, sessions, users } from "../../../db/schema";
import { authErrorResponse, requireActiveMembership, requireAuthContext, requireRole } from "../../../lib/auth";
import { getOrCreateGroupState, syncMembershipsFromWorkspace, upgradeWorkspaceState } from "../../../lib/workspace";
import type { WorkspaceState } from "../../../lib/types";
import { mergePlatformDefaults } from "../../../lib/platforms";
import { randomToken } from "../../../lib/auth";

export async function GET(request: Request) {
  try {
    const context = await requireAuthContext(request);
    const url = new URL(request.url);
    const searchQuery = url.searchParams.get("search")?.trim();

    // 搜索小组模式：返回所有匹配名称的小组（不含当前用户已加入的）
    if (searchQuery && searchQuery.length >= 1) {
      await ensureDatabase();
      const db = getDb();
      const userMembershipGroupIds = context.memberships
        .filter((m) => m.status === "active" || m.status === "pending")
        .map((m) => m.groupId);

      const conditions: Array<ReturnType<typeof sql>> = [sql`${groups.name} ILIKE ${`%${searchQuery}%`}`];
      for (const gid of userMembershipGroupIds) {
        conditions.push(ne(groups.id, gid));
      }

      const rows = await db.select({
        id: groups.id,
        name: groups.name,
        ownerUserId: groups.ownerUserId,
        createdAt: groups.createdAt,
      }).from(groups).where(and(...conditions)).orderBy(groups.name).limit(20);

      // 获取每个小组的成员数量和 owner 姓名
      const results = await Promise.all(rows.map(async (g) => {
        const [owner] = await db.select({ displayName: users.displayName })
          .from(users).where(eq(users.id, g.ownerUserId)).limit(1);
        const [count] = await db.select({ count: sql<number>`count(*)::int` })
          .from(groupMemberships)
          .where(and(eq(groupMemberships.groupId, g.id), eq(groupMemberships.status, "active")));
        // 检查是否已有待审核的申请
        const [pending] = await db.select({ id: groupMemberships.id })
          .from(groupMemberships)
          .where(and(
            eq(groupMemberships.groupId, g.id),
            eq(groupMemberships.userId, context.user.id),
            eq(groupMemberships.status, "pending"),
          )).limit(1);
        return {
          id: g.id,
          name: g.name,
          ownerName: owner?.displayName || "未知",
          memberCount: count?.count || 0,
          hasPendingRequest: !!pending,
        };
      }));

      return Response.json({ groups: results });
    }

    let groupConfig = null;
    if (context.activeMembership) {
      await ensureDatabase();
      const db = getDb();
      const [g] = await db.select({
        id: groups.id,
        name: groups.name,
        ownerUserId: groups.ownerUserId,
        workStart: groups.workStart,
        workEnd: groups.workEnd,
        reportDeadlineWeekday: groups.reportDeadlineWeekday,
        reportDeadlineTime: groups.reportDeadlineTime,
        timezone: groups.timezone,
        searchable: groups.searchable,
      }).from(groups).where(eq(groups.id, context.activeMembership.groupId)).limit(1);
      groupConfig = g || null;
    }
    return Response.json({ memberships: context.memberships, activeMembership: context.activeMembership, groupConfig });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireAuthContext(request);
    requireActiveMembership(context);
    const body = await request.json() as { name?: string; description?: string };
    const name = body.name?.trim().slice(0, 40);
    if (!name) return Response.json({ error: "请输入小组名称" }, { status: 400 });

    await ensureDatabase();
    const db = getDb();

    // 检查同名小组
    const [sameName] = await db.select({ id: groups.id }).from(groups).where(eq(groups.name, name)).limit(1);
    if (sameName) return Response.json({ error: "小组名称已存在" }, { status: 409 });

    const groupId = `g_${crypto.randomUUID().slice(0, 8)}`;
    const membershipId = `gm_${crypto.randomUUID()}`;
    const inviteCode = randomToken(12);
    const joinedAt = new Date().toISOString().slice(0, 10);

    await db.transaction(async (transaction) => {
      await transaction.insert(groups).values({
        id: groupId,
        name,
        ownerUserId: context.user.id,
        inviteCode,
        searchable: false,
        workStart: "10:00",
        workEnd: "19:00",
        reportDeadlineWeekday: 5,
        reportDeadlineTime: "19:00",
        timezone: "Asia/Shanghai",
      });

      await transaction.insert(groupMemberships).values({
        id: membershipId,
        groupId,
        userId: context.user.id,
        role: "leader",
        status: "active",
        joinedAt,
      });

      // 初始化工作区状态
      const initial: WorkspaceState = {
        version: 1,
        platforms: mergePlatformDefaults(),
        contentRows: [],
        members: [{
          id: membershipId,
          name: context.user.displayName,
          role: "leader",
          status: "active",
          initials: context.user.displayName.slice(0, 1),
          color: "#173f3a",
          joinedAt,
        }],
        tasks: [],
        reports: [],
        imports: [],
        notifications: [],
      };
      await transaction.insert(groupWorkspaceStates).values({
        groupId,
        version: 1,
        payload: JSON.stringify(initial),
      });

      await transaction.insert(activityEvents).values({
        id: `evt_${crypto.randomUUID()}`,
        groupId,
        userId: context.user.id,
        actorName: context.user.displayName,
        action: "创建小组",
        target: name,
      });
    });

    return Response.json({ id: groupId, name, inviteCode, membershipId }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireAuthContext(request);
    const active = requireActiveMembership(context);
    requireRole(context, "leader");
    const body = await request.json() as {
      name?: string;
      workStart?: string;
      workEnd?: string;
      reportDeadlineWeekday?: number;
      reportDeadlineTime?: string;
    };
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const trimmed = body.name.trim().slice(0, 40);
      if (!trimmed) return Response.json({ error: "小组名称不能为空" }, { status: 400 });
      await ensureDatabase();
      const db = getDb();
      const [sameName] = await db.select({ id: groups.id }).from(groups).where(
        and(eq(groups.name, trimmed), ne(groups.id, active.groupId))
      ).limit(1);
      if (sameName) return Response.json({ error: "小组名称已存在" }, { status: 409 });
      updates.name = trimmed;
    }
    if (body.workStart !== undefined) updates.workStart = body.workStart;
    if (body.workEnd !== undefined) updates.workEnd = body.workEnd;
    if (body.reportDeadlineWeekday !== undefined) {
      if (body.reportDeadlineWeekday < 0 || body.reportDeadlineWeekday > 6) {
        return Response.json({ error: "周报截止日需为 0（周日）至 6（周六）" }, { status: 400 });
      }
      updates.reportDeadlineWeekday = body.reportDeadlineWeekday;
    }
    if (body.reportDeadlineTime !== undefined) updates.reportDeadlineTime = body.reportDeadlineTime;

    if (Object.keys(updates).length === 0) {
      return Response.json({ ok: true });
    }

    await ensureDatabase();
    const db = getDb();
    updates.updatedAt = sql`CURRENT_TIMESTAMP`;
    await db.update(groups).set(updates).where(eq(groups.id, active.groupId));

    await db.insert(activityEvents).values({
      id: `evt_${crypto.randomUUID()}`,
      groupId: active.groupId,
      userId: context.user.id,
      actorName: context.user.displayName,
      action: "更新小组设置",
      target: active.groupName,
    });

    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireAuthContext(request);
    const active = requireActiveMembership(context);

    await ensureDatabase();
    const db = getDb();

    // 如果是 leader，检查是否还有其他有效 leader
    if (active.role === "leader") {
      const leaders = await db.select({ id: groupMemberships.id }).from(groupMemberships).where(and(
        eq(groupMemberships.groupId, active.groupId),
        eq(groupMemberships.role, "leader"),
        eq(groupMemberships.status, "active"),
        ne(groupMemberships.userId, context.user.id),
      ));
      if (!leaders.length) {
        return Response.json({ error: "你是小组最后一个有效 Leader，不能退出。请先将另一位成员提升为 Leader 或解散小组。" }, { status: 409 });
      }
    }

    // 更新成员关系状态为 left
    await db.update(groupMemberships).set({
      status: "left",
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(groupMemberships.id, active.id));

    // 更新工作区状态
    const state = await getOrCreateGroupState(active.groupId);
    const nextState = {
      ...state,
      version: state.version + 1,
      members: state.members.map((member) =>
        member.id === active.id ? { ...member, status: "left" as const } : member
      ),
      tasks: state.tasks.map((task) =>
        task.assignee === context.user.displayName && task.status !== "已完成"
          ? { ...task, status: "待转交" as const }
          : task
      ),
    };
    await db.update(groupWorkspaceStates).set({
      version: nextState.version,
      payload: JSON.stringify(nextState),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(groupWorkspaceStates.groupId, active.groupId));

    await db.insert(activityEvents).values({
      id: `evt_${crypto.randomUUID()}`,
      groupId: active.groupId,
      userId: context.user.id,
      actorName: context.user.displayName,
      action: "退出小组",
      target: active.groupName,
    });

    // 清除 session 中的 activeGroupId，让用户重新选择或停留在无工作区页面
    await db.update(sessions).set({
      activeGroupId: null,
      lastSeenAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(sessions.id, context.sessionId));

    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
