import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { auditEvents, sessions, users } from "../../../../../db/schema";
import {
  authErrorResponse,
  hashPassword,
  requireAuthContext,
  validateNewPassword,
  verifyPassword,
} from "../../../../../lib/auth";

export async function POST(request: Request) {
  try {
    const context = await requireAuthContext(request);
    const body = await request.json() as { currentPassword?: string; newPassword?: string };
    const currentPassword = body.currentPassword || "";
    const newPassword = body.newPassword || "";
    const validationError = validateNewPassword(newPassword);
    if (validationError) return Response.json({ error: validationError }, { status: 400 });
    if (currentPassword === newPassword) return Response.json({ error: "新密码不能与当前密码相同" }, { status: 400 });

    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.id, context.user.id)).limit(1);
    if (!user || !(await verifyPassword(user.passwordHash, currentPassword).catch(() => false))) {
      return Response.json({ error: "当前密码不正确" }, { status: 401 });
    }

    await db.transaction(async (transaction) => {
      await transaction.update(users).set({
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
        passwordChangedAt: new Date().toISOString(),
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }).where(eq(users.id, user.id));
      await transaction.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, context.sessionId)));
      await transaction.insert(auditEvents).values({ actor: user.username, action: "修改密码", target: user.id });
    });
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
