#!/usr/bin/env bash
# 把 vela 仓库的 overlay 层同步进源码树（幂等，可重复执行）
set -euo pipefail
VELA="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${VELA}-src"
rsync -a --delete "$VELA/overlay/browser/" "$SRC/browser/"
cp "$VELA/overlay/mozconfig" "$SRC/mozconfig"
echo "overlay applied → $SRC"
