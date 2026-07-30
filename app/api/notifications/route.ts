import { and, desc, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../db";
import { notificationJobs } from "../../../db/schema";
import { authErrorResponse, requireActiveMembership, requireAuthContext } from "../../../lib/auth";

export async function GET(request: Request) {
  try {
    const context = await requireAuthContext(request);
    const active = requireActiveMembership(context);
    await ensureDatabase();
    const rows = await getDb().select().from(notificationJobs).where(and(
      eq(notificationJobs.groupId, active.groupId),
      eq(notificationJobs.userId, context.user.id),
    )).orderBy(desc(notificationJobs.createdAt)).limit(100);
    return Response.json({ notifications: rows });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireAuthContext(request);
    const active = requireActiveMembership(context);
    const body = await request.json() as { id?: string; all?: boolean };
    await ensureDatabase();
    const db = getDb();
    const base = and(
      eq(notificationJobs.groupId, active.groupId),
      eq(notificationJobs.userId, context.user.id),
    );
    if (body.all) {
      await db.update(notificationJobs).set({ readAt: new Date().toISOString() }).where(base);
    } else if (body.id) {
      await db.update(notificationJobs).set({ readAt: new Date().toISOString() }).where(and(base, eq(notificationJobs.id, body.id)));
    } else {
      return Response.json({ error: "缺少通知编号" }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
