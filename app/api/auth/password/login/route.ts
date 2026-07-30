import { and, eq, sql } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../../db";
import { auditEvents, groupMemberships, users } from "../../../../../db/schema";
import {
  createSession,
  hashPassword,
  normalizeUsername,
  sessionCookie,
  verifyPassword,
} from "../../../../../lib/auth";

const dummyHash = hashPassword("Not-A-Real-Password-2026");

export async function POST(request: Request) {
  try {
    const body = await request.json() as { username?: string; password?: string };
    const username = normalizeUsername(body.username || "");
    const password = body.password || "";
    if (!username || !password) return Response.json({ error: "用户名或密码不正确" }, { status: 400 });

    await ensureDatabase();
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (!user) {
      await verifyPassword(await dummyHash, password).catch(() => false);
      return Response.json({ error: "用户名或密码不正确" }, { status: 401 });
    }
    if (user.status !== "active") return Response.json({ error: "账号已停用，请联系 Leader" }, { status: 403 });
    if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
      return Response.json({ error: "登录失败次数过多，请15分钟后重试" }, { status: 423 });
    }

    const valid = await verifyPassword(user.passwordHash, password).catch(() => false);
    if (!valid) {
      const attempts = user.failedLoginAttempts + 1;
      const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
      await db.update(users).set({
        failedLoginAttempts: attempts >= 5 ? 0 : attempts,
        lockedUntil,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }).where(eq(users.id, user.id));
      await db.insert(auditEvents).values({ actor: username, action: "登录失败", target: lockedUntil ? "账号已临时锁定" : "密码校验失败" });
      return Response.json({ error: lockedUntil ? "登录失败次数过多，账号已锁定15分钟" : "用户名或密码不正确" }, { status: 401 });
    }

    await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(users.id, user.id));
    const [membership] = await db.select().from(groupMemberships).where(and(
      eq(groupMemberships.userId, user.id),
      eq(groupMemberships.status, "active"),
    )).limit(1);
    const session = await createSession(user.id, membership?.groupId);
    await db.insert(auditEvents).values({ actor: username, action: "登录成功", target: membership?.groupId || "未分配小组" });
    return Response.json({
      ok: true,
      mustChangePassword: user.mustChangePassword,
    }, { headers: { "Set-Cookie": sessionCookie(session.token) } });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "登录服务暂不可用" }, { status: 500 });
  }
}
