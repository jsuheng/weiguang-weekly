#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$PROJECT_DIR/outputs"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="$OUTPUT_DIR/weiguang-weekly-intranet-handoff-$STAMP.tar.gz"

cd "$PROJECT_DIR"
[[ -f .env ]] || {
  echo "ERROR: .env is required in the complete operations package." >&2
  exit 1
}
SKIP_DOCKER_CHECK="${SKIP_DOCKER_CHECK:-0}" bash scripts/preflight.sh
mkdir -p "$OUTPUT_DIR"

tar -czf "$ARCHIVE" \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='./.next' \
  --exclude='./.local-data' \
  --exclude='./.pnpm-store' \
  --exclude='./.env.local' \
  --exclude='./.DS_Store' \
  --exclude='./.vinext' \
  --exclude='./.wrangler' \
  --exclude='./.openai' \
  --exclude='./dist' \
  --exclude='./deploy.env' \
  --exclude='./outputs' \
  --exclude='./backups' \
  --exclude='./*.tsbuildinfo' \
  .

(
  cd "$OUTPUT_DIR"
  shasum -a 256 "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256"
)
echo "Handoff archive: $ARCHIVE"
echo "Checksum file: $ARCHIVE.sha256"
