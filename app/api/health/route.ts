import { sql } from "drizzle-orm";
import { checkFileStorage, ensureDatabase, getDb } from "../../../db";

export const dynamic = "force-dynamic";

const CORE_TABLES = [
  "users",
  "groups",
  "group_memberships",
  "sessions",
  "group_workspace_states",
  "import_data_batches",
  "notification_jobs",
] as const;

export async function GET() {
  let database = false;
  let schemaReady = false;
  let fileStorage = false;
  let databaseError: string | null = null;
  let schemaError: string | null = null;
  let fileStorageError: string | null = null;

  try {
    await ensureDatabase();
    database = true;

    // 验证核心业务表已创建（确保迁移已执行，不只检查数据库连接）
    try {
      const db = getDb();
      for (const table of CORE_TABLES) {
        await db.execute(sql.raw(`SELECT 1 FROM "${table}" LIMIT 0`));
      }
      schemaReady = true;
    } catch (error) {
      schemaError = error instanceof Error ? error.message.slice(0, 160) : "schema check failed";
    }
  } catch (error) {
    databaseError = error instanceof Error ? error.message.slice(0, 160) : "database unavailable";
  }

  try {
    fileStorage = await checkFileStorage();
  } catch (error) {
    fileStorageError = error instanceof Error ? error.message.slice(0, 160) : "file storage unavailable";
  }

  const ready = database && schemaReady && fileStorage;
  return Response.json({
    status: ready ? "ok" : "unavailable",
    environment: process.env.APP_ENV || process.env.NODE_ENV || "unknown",
    version: process.env.APP_VERSION || "unknown",
    checks: { database, schemaReady, fileStorage },
    errors: { database: databaseError, schema: schemaError, fileStorage: fileStorageError },
    timestamp: new Date().toISOString(),
  }, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
