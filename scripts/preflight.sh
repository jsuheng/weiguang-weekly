#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
ENV_FILE="${ENV_FILE:-.env}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

if [[ "${SKIP_DOCKER_CHECK:-0}" != "1" ]]; then
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed."
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is unavailable."
fi
[[ -f "$ENV_FILE" ]] || fail "Missing $ENV_FILE; copy .env.example first."
[[ -f "Dockerfile" && -f "docker-compose.yaml" && -f "pnpm-lock.yaml" ]] || fail "Deployment files are incomplete."
compgen -G "drizzle/*.sql" >/dev/null || fail "PostgreSQL migrations are missing."

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

required=(
  APP_BASE_URL PASSWORD_PEPPER CRON_SECRET
  POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL
  FILE_STORAGE_DIR FILE_STORAGE_HOST_PATH
)
for key in "${required[@]}"; do
  value="${!key:-}"
  [[ -n "$value" ]] || fail "$key is empty."
  [[ "$value" != *"replace-with"* && "$value" != *".example"* ]] || fail "$key still contains an example placeholder."
done

[[ ${#PASSWORD_PEPPER} -ge 32 ]] || fail "PASSWORD_PEPPER must contain at least 32 characters."
[[ ${#CRON_SECRET} -ge 32 ]] || fail "CRON_SECRET must contain at least 32 characters."
[[ "$APP_BASE_URL" == http://* || "$APP_BASE_URL" == https://* ]] || fail "APP_BASE_URL must start with http:// or https://."
if [[ "$APP_BASE_URL" == http://* && "${COOKIE_SECURE:-auto}" != "false" ]]; then
  fail "HTTP deployment requires COOKIE_SECURE=false."
fi
[[ "$FILE_STORAGE_DIR" == /* && "$FILE_STORAGE_DIR" != "/" ]] || fail "FILE_STORAGE_DIR must be a safe absolute container path."
[[ "$FILE_STORAGE_HOST_PATH" == /* && "$FILE_STORAGE_HOST_PATH" != "/" ]] || fail "FILE_STORAGE_HOST_PATH must be a safe absolute host path."

if [[ "${SKIP_DOCKER_CHECK:-0}" != "1" ]]; then
  docker compose --env-file "$ENV_FILE" config >/dev/null
fi
echo "Preflight passed."
