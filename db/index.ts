import { PGlite } from "@electric-sql/pglite";
import { hash } from "@node-rs/argon2";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import postgres from "postgres";
import { demoState } from "../lib/demo-data";
import * as schema from "./schema";

const createProductionDb = () => drizzlePostgres(getSqlClient(), { schema });
type AppDatabase = ReturnType<typeof createProductionDb>;

type DatabaseGlobals = typeof globalThis & {
  __weiguangSql?: ReturnType<typeof postgres>;
  __weiguangPglite?: PGlite;
  __weiguangDb?: AppDatabase;
  __weiguangDatabaseReady?: Promise<void>;
  __weiguangDemoReady?: Promise<void>;
};

const globals = globalThis as DatabaseGlobals;

function localDatabaseEnabled() {
  return Boolean(process.env.LOCAL_DATABASE_DIR);
}

function requiredEnvironment(name: string, developmentFallback?: string) {
  const value = process.env[name] || (process.env.NODE_ENV !== "production" ? developmentFallback : undefined);
  if (!value) throw new Error(`缺少运行环境变量 ${name}`);
  return value;
}

export function getSqlClient() {
  if (!globals.__weiguangSql) {
    globals.__weiguangSql = postgres(
      requiredEnvironment("DATABASE_URL", "postgresql://weiguang:weiguang@127.0.0.1:5432/weiguang"),
      { max: Number(process.env.DATABASE_POOL_SIZE || 10), prepare: false },
    );
  }
  return globals.__weiguangSql;
}

export function getDb(): AppDatabase {
  if (!globals.__weiguangDb) {
    if (localDatabaseEnabled()) {
      const localDirectory = resolve(process.env.LOCAL_DATABASE_DIR!);
      mkdirSync(resolve(localDirectory, ".."), { recursive: true });
      globals.__weiguangPglite = new PGlite(localDirectory);
      globals.__weiguangDb = drizzlePglite(globals.__weiguangPglite, { schema }) as unknown as AppDatabase;
    } else {
      globals.__weiguangDb = createProductionDb();
    }
  }
  return globals.__weiguangDb;
}

export function getFileStorageDirectory() {
  const configured = process.env.FILE_STORAGE_DIR || process.env.LOCAL_STORAGE_DIR;
  if (configured) return resolve(configured);
  if (process.env.NODE_ENV === "production") throw new Error("缺少运行环境变量 FILE_STORAGE_DIR");
  return resolve(".local-data/files");
}

function resolveStoredFile(key: string) {
  const root = getFileStorageDirectory();
  const target = resolve(root, key);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("文件存储路径不安全");
  return target;
}

export async function putStoredFile(
  key: string,
  body: ArrayBuffer,
  options: { contentType: string; metadata: Record<string, string> },
) {
  const target = resolveStoredFile(key);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, new Uint8Array(body));
  await writeFile(`${target}.metadata.json`, JSON.stringify({ contentType: options.contentType, ...options.metadata }, null, 2));
}

export async function checkFileStorage() {
  const root = getFileStorageDirectory();
  await mkdir(root, { recursive: true });
  const probe = resolveStoredFile(`.health-${crypto.randomUUID()}`);
  await writeFile(probe, "ok");
  await unlink(probe);
  return true;
}

export async function ensureDatabase() {
  if (!globals.__weiguangDatabaseReady) {
    globals.__weiguangDatabaseReady = (async () => {
      if (localDatabaseEnabled()) {
        await migratePglite(getDb() as unknown as Parameters<typeof migratePglite>[0], { migrationsFolder: resolve(process.cwd(), "drizzle") });
      }
      await getDb().execute(sql`SELECT 1`);
    })();
  }
  return globals.__weiguangDatabaseReady;
}

/**
 * Local demo accounts are available only through the localhost-only dev route.
 * Production startup never calls this function.
 */
export function ensureDemoData() {
  if (!globals.__weiguangDemoReady) {
    globals.__weiguangDemoReady = (async () => {
      if (process.env.NODE_ENV === "production") throw new Error("生产环境禁止初始化演示账号");
      await ensureDatabase();
      const db = getDb();
      const demoPasswordHash = await hash(`Demo-Weekly-2026\u0000${process.env.PASSWORD_PEPPER || "development-only-pepper"}`, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
      const payload = JSON.stringify(demoState);
      await db.transaction(async (transaction) => {
        await transaction.insert(schema.users).values([
          { id: "u_leader", username: "leader-demo", displayName: "姜姗", passwordHash: demoPasswordHash, mustChangePassword: false },
          { id: "u_intern_lin", username: "intern-demo", displayName: "林小满", passwordHash: demoPasswordHash, mustChangePassword: false },
        ]).onConflictDoNothing();
        await transaction.insert(schema.groups).values({
          id: "g_content_growth",
          name: "内容增长组",
          ownerUserId: "u_leader",
          inviteCode: "INTERNAL",
          searchable: false,
        }).onConflictDoNothing();
        await transaction.insert(schema.groupMemberships).values([
          { id: "gm_leader", groupId: "g_content_growth", userId: "u_leader", role: "leader", status: "active", joinedAt: "2026-04-08" },
          { id: "gm_lin", groupId: "g_content_growth", userId: "u_intern_lin", role: "intern", status: "active", joinedAt: "2026-05-12" },
        ]).onConflictDoNothing();
        await transaction.insert(schema.groupWorkspaceStates).values({
          groupId: "g_content_growth",
          version: 1,
          payload,
        }).onConflictDoNothing();
      });
    })();
  }
  return globals.__weiguangDemoReady;
}
