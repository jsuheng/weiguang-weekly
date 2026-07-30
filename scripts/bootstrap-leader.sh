#!/bin/sh
set -eu

USERNAME="${1:-leader}"
DISPLAY_NAME="${2:-Leader}"
GROUP_NAME="${3:-内容增长组}"

printf "请输入 %s 的临时密码（至少10位，含字母和数字）: " "$USERNAME"
stty -echo
IFS= read -r TEMP_PASSWORD
stty echo
printf "\n"
printf "%s" "$TEMP_PASSWORD" | docker compose exec -T app node scripts/bootstrap-leader.mjs \
  --username "$USERNAME" \
  --display-name "$DISPLAY_NAME" \
  --group-name "$GROUP_NAME" \
  --password-stdin
