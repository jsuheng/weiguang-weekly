import { checkFileStorage, ensureDatabase } from "../../../db";

export const dynamic = "force-dynamic";

export async function GET() {
  let database = false;
  let fileStorage = false;
  let databaseError: string | null = null;
  let fileStorageError: string | null = null;

  try {
    await ensureDatabase();
    database = true;
  } catch (error) {
    databaseError = error instanceof Error ? error.message.slice(0, 160) : "database unavailable";
  }

  try {
    fileStorage = await checkFileStorage();
  } catch (error) {
    fileStorageError = error instanceof Error ? error.message.slice(0, 160) : "file storage unavailable";
  }

  const ready = database && fileStorage;
  return Response.json({
    status: ready ? "ok" : "unavailable",
    environment: process.env.APP_ENV || process.env.NODE_ENV || "unknown",
    version: process.env.APP_VERSION || "unknown",
    checks: { database, fileStorage },
    errors: { database: databaseError, fileStorage: fileStorageError },
    timestamp: new Date().toISOString(),
  }, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
