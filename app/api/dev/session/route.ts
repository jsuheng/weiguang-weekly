import { and, eq } from "drizzle-orm";
import { ensureDemoData, getDb } from "../../../../db";
import { groupMemberships } from "../../../../db/schema";
import { createSession, sessionCookie } from "../../../../lib/auth";

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    return Response.json({ error: "演示会话仅允许在本机使用" }, { status: 404 });
  }

  const body = await request.json() as { role?: "leader" | "intern" };
  const userId = body.role === "intern" ? "u_intern_lin" : "u_leader";
  await ensureDemoData();
  const [membership] = await getDb().select().from(groupMemberships).where(and(
    eq(groupMemberships.userId, userId),
    eq(groupMemberships.status, "active"),
  )).limit(1);
  const session = await createSession(userId, membership?.groupId);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(session.token) } });
}
