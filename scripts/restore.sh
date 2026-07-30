#!/bin/sh
set -eu

TARGET="${1:?用法: scripts/restore.sh /data/weiguang/backups/YYYYMMDD_HHMMSS}"
[ -f "$TARGET/postgres.dump" ] || { echo "缺少 postgres.dump"; exit 1; }
[ -f "$TARGET/files.tar.gz" ] || { echo "缺少 files.tar.gz"; exit 1; }
FILE_ROOT="${FILE_STORAGE_HOST_PATH:-/data/weiguang/files}"
[ -n "$FILE_ROOT" ] && [ "$FILE_ROOT" != "/" ] || { echo "FILE_STORAGE_HOST_PATH 不安全"; exit 1; }

printf "恢复会覆盖当前数据库与文件，输入 RESTORE 继续: "
IFS= read -r CONFIRM
[ "$CONFIRM" = "RESTORE" ] || { echo "已取消"; exit 1; }

docker compose stop reminder app
docker compose exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"
docker compose exec -T postgres createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < "$TARGET/postgres.dump"
if [ -d "$FILE_ROOT" ]; then
  mv "$FILE_ROOT" "${FILE_ROOT}.before-restore.$(date +%Y%m%d_%H%M%S)"
fi
mkdir -p "$FILE_ROOT"
tar -C "$FILE_ROOT" -xzf "$TARGET/files.tar.gz"
chown -R 1000:1000 "$FILE_ROOT"
docker compose up -d app reminder
echo "Restore completed."
