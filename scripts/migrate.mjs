import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = postgres(databaseUrl, { max: 1, prepare: false });
const migrationsDirectory = resolve(process.cwd(), "drizzle");

try {
  await sql`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const [applied] = await sql`SELECT name FROM app_migrations WHERE name = ${file}`;
    if (applied) continue;
    const source = await readFile(resolve(migrationsDirectory, file), "utf8");
    const statements = source.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
    await sql.begin(async (transaction) => {
      for (const statement of statements) await transaction.unsafe(statement);
      await transaction`INSERT INTO app_migrations (name) VALUES (${file})`;
    });
    console.log(`Applied migration ${file}`);
  }
} finally {
  await sql.end();
}
