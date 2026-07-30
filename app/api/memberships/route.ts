import { and, eq, sql } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../db";
import { groupMemberships, users } from "../../../db/schema";
import { authErrorResponse, requireActiveMembership, requireAuthContext, requireRole } from "../../../lib/auth";

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
    const active = requireActiveMembership(context);
    requireRole(context, "leader");
    const body = await request.json() as { membershipId?: string; action?: "approve" | "reject" | "remove" };
    if (!body.membershipId || !body.action) return Response.json({ error: "缺少审批参数" }, { status: 400 });

    await ensureDatabase();
    const db = getDb();
    const [target] = await db.select().from(groupMemberships).where(and(
      eq(groupMemberships.id, body.membershipId),
      eq(groupMemberships.groupId, active.groupId),
    )).limit(1);
    if (!target) return Response.json({ error: "成员关系不存在" }, { status: 404 });
    if (target.role === "leader") return Response.json({ error: "不能移除小组所有者" }, { status: 403 });

    const status = body.action === "approve" ? "active" : body.action === "reject" ? "rejected" : "left";
    await db.update(groupMemberships).set({
      status,
      joinedAt: body.action === "approve" ? new Date().toISOString().slice(0, 10) : target.joinedAt,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(groupMemberships.id, target.id));
    return Response.json({ ok: true, status });
  } catch (error) {
    return authErrorResponse(error);
  }
}
