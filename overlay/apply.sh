#!/usr/bin/env bash
# 把 vela 仓库的 overlay 层同步进源码树（幂等，可重复执行）
# 只精确同步自有子树（branding/vela），绝不对上游大目录用 --delete，
# 避免删掉源码树里的上游文件（2026-09-07 事故教训：曾 --delete 掉整棵 browser/）
#
# overlay 结构：
#   overlay/browser/branding/vela/   品牌目录（Vela 专属）
#   overlay/mozconfig                构建配置
#   overlay/upstream/<相对路径>       改过的上游文件整文件收编（升级 overlay 时需 diff 复查）
set -euo pipefail
VELA="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${VELA}-src"

# 品牌目录：目标本身就是 vela 专属目录，--delete 安全
mkdir -p "$SRC/browser/branding"
rsync -a --delete "$VELA/overlay/browser/branding/vela/" "$SRC/browser/branding/vela/"

# 上游文件收编：只覆盖清单里存在的文件，绝不删除上游文件
if [ -d "$VELA/overlay/upstream" ]; then
  rsync -a "$VELA/overlay/upstream/" "$SRC/"
fi

# l10n 补丁：zh-CN 语言树的品牌文案修正，同步进 firefox-l10n 本地树
if [ -d "$VELA/overlay/l10n" ]; then
  rsync -a "$VELA/overlay/l10n/" "$HOME/.mozbuild/l10n-central/zh-CN/"
fi

# mozconfig：mach 默认读取源码树根目录的 mozconfig
cp "$VELA/overlay/mozconfig" "$SRC/mozconfig"
echo "overlay applied → $SRC"
