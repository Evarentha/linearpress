#!/usr/bin/env sh
#
# Author: MoyuZJ
# Team: LinearTeam
# Contact: linearteam@foxmail.com
# Made by MoyuZJ in China with ♥
#
# 将工作区 Plugins/<id> 开发仓库同步到运行目录 src/plugins/<id>。
# 排除 .git、.gitignore 与用户上传内容（ac-files）。
# 用法：npm run sync  或  sh scripts/sync-plugins.sh [plugin-id ...]

set -e
cd "$(dirname "$0")/.."

ROOT="$(pwd)"
SRC="$ROOT/../Plugins"
DEST="$ROOT/src/plugins"

if [ ! -d "$SRC" ]; then
  echo "[sync] 未找到开发插件目录：$SRC"
  exit 0
fi

if [ "$#" -gt 0 ]; then
  PLUGINS="$*"
else
  PLUGINS=$(cd "$SRC" && ls -d */ 2>/dev/null | tr -d '/' || true)
fi

for id in $PLUGINS; do
  if [ ! -d "$SRC/$id" ]; then
    echo "[sync] 跳过（不存在）：$id"
    continue
  fi
  mkdir -p "$DEST/$id"
  (cd "$SRC/$id" && tar cf - --exclude='.git' --exclude='.gitignore' --exclude='public/ac-files' .) | (cd "$DEST/$id" && tar xf -)
  echo "[sync] $id -> src/plugins/$id"
done

echo "[sync] 完成"
