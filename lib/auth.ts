import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt } from "drizzle-orm";
import { ensureDatabase, getDb } from "../db";
import { groupMemberships, groups, sessions, users } from "../db/schema";

export const SESSION_COOKIE = "wg_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export type ActiveMembership = {
  id: string;
  groupId: string;
  groupName: string;
  role: "leader" | "intern";
  status: "active";
};

export type AuthContext = {
  sessionId: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    mustChangePassword: boolean;
  };
  activeMembership: ActiveMembership | null;
  memberships: Array<{
    id: string;
    groupId: string;
    groupName: string;
    role: "leader" | "intern";
    status: "active" | "pending" | "left" | "rejected";
  }>;
};

export class AuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeUsername(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalized) ? normalized : null;
}

function passwordValue(password: string) {
  return `${password}\u0000${process.env.PASSWORD_PEPPER || "development-only-pepper"}`;
}

export function validateNewPassword(password: string) {
  if (password.length < 10) return "新密码至少需要10位";
  if (password.length > 128) return "密码不能超过128位";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "密码必须同时包含字母和数字";
  return null;
}

export function hashPassword(password: string) {
  return hash(passwordValue(password), PASSWORD_OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string) {
  return verify(passwordHash, passwordValue(password));
}

export function generateTemporaryPassword() {
  return `Wg-${randomToken(9)}-8a`;
}

export function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64UrlEncode(bytes);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function shouldUseSecureCookie() {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return (process.env.APP_BASE_URL || "").startsWith("https://");
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; ${shouldUseSecureCookie() ? "Secure; " : ""}SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; ${shouldUseSecureCookie() ? "Secure; " : ""}SameSite=Lax; Max-Age=0`;
}

export async function createSession(userId: string, activeGroupId?: string | null) {
  await ensureDatabase();
  const db = getDb();
  const token = randomToken();
  const tokenHash = await sha256(token);
  const id = `sess_${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  await db.insert(sessions).values({ id, userId, tokenHash, activeGroupId: activeGroupId || null, expiresAt });
  return { id, token, expiresAt };
}

export async function deleteSession(request: Request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  await ensureDatabase();
  await getDb().delete(sessions).where(eq(sessions.tokenHash, await sha256(token)));
}

export async function getAuthContext(request: Request): Promise<AuthContext | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  await ensureDatabase();
  const db = getDb();
  const now = new Date().toISOString();
  const tokenHash = await sha256(token);
  const [sessionRow] = await db.select().from(sessions).where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now))).limit(1);
  if (!sessionRow) return null;

  const [user] = await db.select().from(users).where(and(eq(users.id, sessionRow.userId), eq(users.status, "active"))).limit(1);
  if (!user) return null;

  const membershipRows = await db
    .select({
      id: groupMemberships.id,
      groupId: groupMemberships.groupId,
      groupName: groups.name,
      role: groupMemberships.role,
      status: groupMemberships.status,
    })
    .from(groupMemberships)
    .innerJoin(groups, eq(groupMemberships.groupId, groups.id))
    .where(eq(groupMemberships.userId, user.id));

  const activeRows = membershipRows.filter((item) => item.status === "active");
  const active = activeRows.find((item) => item.groupId === sessionRow.activeGroupId) || activeRows[0];
  await db.update(sessions).set({
    activeGroupId: active?.groupId || null,
    lastSeenAt: now,
  }).where(eq(sessions.id, sessionRow.id));

  return {
    sessionId: sessionRow.id,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      mustChangePassword: user.mustChangePassword,
    },
    activeMembership: active ? {
      id: active.id,
      groupId: active.groupId,
      groupName: active.groupName,
      role: active.role,
      status: "active",
    } : null,
    memberships: membershipRows,
  };
}

export async function requireAuthContext(request: Request): Promise<AuthContext> {
  const context = await getAuthContext(request);
  if (!context) throw new AuthError("请先登录", 401);
  return context;
}

export function requirePasswordChanged(context: AuthContext) {
  if (context.user.mustChangePassword) throw new AuthError("请先修改临时密码", 403);
}

export function requireRole(context: AuthContext, ...roles: Array<"leader" | "intern">) {
  requirePasswordChanged(context);
  if (!context.activeMembership || !roles.includes(context.activeMembership.role)) {
    throw new AuthError("当前职位无权执行此操作", 403);
  }
}

export function requireActiveMembership(context: AuthContext): ActiveMembership {
  requirePasswordChanged(context);
  if (!context.activeMembership) throw new AuthError("请联系 Leader 分配小组权限", 403);
  return context.activeMembership;
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: error instanceof Error ? error.message : "服务暂不可用" }, { status: 500 });
}
