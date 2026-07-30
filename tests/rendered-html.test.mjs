import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("renders the internal operations workspace and account login", async () => {
  const [page, app] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/WorkspaceApp.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<WorkspaceApp \/>/);
  assert.match(app, />周报</);
  assert.match(app, />Weekly</);
  assert.match(app, />Report</);
  assert.match(app, /账号密码登录/);
  assert.match(app, /首次登录需要修改临时密码/);
  assert.match(app, /创建内部账号/);
  assert.match(app, /重置密码/);
  assert.match(app, /站内提醒已启用/);
  assert.match(app, /工作台/);
  assert.match(app, /账号数据/);
  assert.match(app, /管理平台/);
  assert.match(app, /按名称 \/ 别名 \/ 链接自动匹配/);
  assert.match(app, /onDrop=/);
  assert.doesNotMatch(`${page}\n${app}`, /codex-preview|Your site is taking shape/i);
});

test("ships PostgreSQL, server filesystem storage and password authentication contracts", async () => {
  const [schema, packageJson, database, importRoute, loginRoute, changeRoute, accountRoute, healthRoute, compose] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/imports/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/password/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/password/change/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/accounts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../docker-compose.yaml", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /pgTable/);
  assert.match(schema, /username/);
  assert.match(schema, /passwordHash/);
  assert.match(schema, /mustChangePassword/);
  assert.match(schema, /notificationJobs/);
  assert.match(database, /FILE_STORAGE_DIR/);
  assert.match(database, /writeFile/);
  assert.match(database, /drizzle-orm\/postgres-js/);
  assert.match(importRoute, /putStoredFile/);
  assert.match(loginRoute, /failedLoginAttempts/);
  assert.match(loginRoute, /15 \* 60_000/);
  assert.match(changeRoute, /validateNewPassword/);
  assert.match(accountRoute, /generateTemporaryPassword/);
  assert.match(healthRoute, /checkFileStorage/);
  assert.match(compose, /postgres:/);
  assert.match(compose, /FILE_STORAGE_HOST_PATH/);
  assert.match(compose, /env_file:\s*\n\s+- \.env/);
  assert.doesNotMatch(compose, /\.env\.production/);
  assert.doesNotMatch(compose, /minio:/i);
  assert.match(compose, /sleep 600/);
  assert.doesNotMatch(packageJson, /vinext|wrangler|client-s3/);
});

test("includes reproducible intranet operations and recovery files", async () => {
  const [runbook, dockerfile, compose, pipeline, preflight, backup, restore, bootstrap, environment] = await Promise.all([
    readFile(new URL("../docs/运维部署交接手册.md", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../docker-compose.yaml", import.meta.url), "utf8"),
    readFile(new URL("../.gitlab-ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../scripts/preflight.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/backup.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/restore.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/bootstrap-leader.sh", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(runbook, /网站有后端|全栈应用/);
  assert.match(runbook, /共用一个内网域名/);
  assert.match(dockerfile, /pnpm install --frozen-lockfile/);
  assert.match(dockerfile, /USER node/);
  assert.match(compose, /7019:3000/);
  assert.match(pipeline, /SSH_KNOWN_HOSTS/);
  assert.match(pipeline, /\/api\/health/);
  assert.match(pipeline, /--env-file \.env/);
  assert.doesNotMatch(pipeline, /\.env\.production/);
  assert.match(preflight, /docker compose/);
  assert.match(preflight, /ENV_FILE:-\.env/);
  assert.match(preflight, /FILE_STORAGE_HOST_PATH/);
  assert.match(backup, /pg_dump/);
  assert.match(backup, /cp \.env /);
  assert.match(backup, /files\.tar\.gz/);
  assert.match(restore, /pg_restore/);
  assert.match(restore, /files\.tar\.gz/);
  assert.match(bootstrap, /password-stdin/);
  assert.match(environment, /PASSWORD_PEPPER/);
  assert.match(environment, /DATABASE_URL/);
  assert.match(environment, /FILE_STORAGE_DIR/);
  assert.match(environment, /FILE_STORAGE_HOST_PATH/);
});
