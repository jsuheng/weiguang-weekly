import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../db";
import { groupMemberships, sessions } from "../../../../db/schema";
import { authErrorResponse, requireAuthContext } from "../../../../lib/auth";

export async function POST(request: Request) {
  try {
    const context = await requireAuthContext(request);
    const body = await request.json() as { groupId?: string };
    if (!body.groupId) return Response.json({ error: "缺少小组编号" }, { status: 400 });

    await ensureDatabase();
    const db = getDb();
    const [membership] = await db.select().from(groupMemberships).where(and(
      eq(groupMemberships.userId, context.user.id),
      eq(groupMemberships.groupId, body.groupId),
      eq(groupMemberships.status, "active"),
    )).limit(1);
    if (!membership) return Response.json({ error: "你不是该小组的在组成员" }, { status: 403 });

    await db.update(sessions).set({ activeGroupId: body.groupId, lastSeenAt: new Date().toISOString() }).where(eq(sessions.id, context.sessionId));
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
