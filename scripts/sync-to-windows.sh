#!/usr/bin/env bash
# 把 src/ 镜像到 D 盘，供 Windows Chrome 加载已解压的扩展程序。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="/mnt/d/APP/Chrome-Extensions/split-search"

if [ ! -d "$(dirname "$DEST")" ]; then
  echo "错误：目标父目录不存在：$(dirname "$DEST")" >&2
  exit 1
fi

mkdir -p "$DEST"
rsync -a --delete "$ROOT/src/" "$DEST/"
echo "已同步到 $DEST"
echo "到 chrome://extensions 点重新加载（不要移除重装）"
