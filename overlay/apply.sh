#!/usr/bin/env bash
# 把 vela 仓库的 overlay 层同步进源码树（幂等，可重复执行）
# 只精确同步自有子树（branding/vela），绝不对上游大目录用 --delete，
# 避免删掉源码树里的上游文件（2026-09-07 事故教训：曾 --delete 掉整棵 browser/）
set -euo pipefail
VELA="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${VELA}-src"

# 品牌目录：目标本身就是 vela 专属目录，--delete 安全
mkdir -p "$SRC/browser/branding"
rsync -a --delete "$VELA/overlay/browser/branding/vela/" "$SRC/browser/branding/vela/"

# mozconfig：mach 默认读取源码树根目录的 mozconfig
cp "$VELA/overlay/mozconfig" "$SRC/mozconfig"
echo "overlay applied → $SRC"
