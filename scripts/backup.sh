#!/bin/sh
set -eu

BACKUP_ROOT="${BACKUP_ROOT:-/data/weiguang/backups}"
[ -n "$BACKUP_ROOT" ] && [ "$BACKUP_ROOT" != "/" ] || { echo "BACKUP_ROOT 不安全"; exit 1; }
FILE_ROOT="${FILE_STORAGE_HOST_PATH:-/data/weiguang/files}"
[ -n "$FILE_ROOT" ] && [ "$FILE_ROOT" != "/" ] || { echo "FILE_STORAGE_HOST_PATH 不安全"; exit 1; }
STAMP="$(date +%Y%m%d_%H%M%S)"
TARGET="$BACKUP_ROOT/$STAMP"
mkdir -p "$TARGET"
mkdir -p "$FILE_ROOT"

docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$TARGET/postgres.dump"
tar -C "$FILE_ROOT" -czf "$TARGET/files.tar.gz" .
cp docker-compose.yaml "$TARGET/docker-compose.yaml"
cp .env "$TARGET/env.snapshot"
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
echo "Backup created: $TARGET"
