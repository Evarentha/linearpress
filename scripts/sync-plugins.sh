#!/usr/bin/env sh
# LinearPress Sync Plugins
#
# Implements the sync plugins module for LinearPress.
#
# Authors:
# MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
# worryzu <worryzu@gmail.com> @LinearTeam
#
# Copyright (C) 2026 Evarentha
# SPDX-License-Identifier: GPL-3.0-or-later

#
# LinearPress Plugin Workspace Sync Script
#
# Syncs development plugin repositories into the runtime plugin directory.
#
# Authors:
# MoyuZJ <moyuzj@moyuzj.cn> @LinearTeam - Made in China with ♥
#
# Copyright (C) 2026 Evarentha
# SPDX-License-Identifier: GPL-3.0-or-later

# Syncs the workspace Plugins/<id> development repositories into the runtime
# directory src/plugins/<id>, excluding .git, .gitignore and user-uploaded
# content (ac-files).
# Usage: npm run sync  or  sh scripts/sync-plugins.sh [plugin-id ...]
#
# @since 2.0.1

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
