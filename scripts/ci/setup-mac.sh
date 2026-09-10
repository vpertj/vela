#!/usr/bin/env bash
# CI(macOS) 环境准备：源码树 + l10n + bootstrap（在 vela 仓库 checkout 内运行）
# 前置：vela 仓库已 checkout 到 $GITHUB_WORKSPACE/vela
set -euo pipefail
WS="${GITHUB_WORKSPACE:-$(pwd)}"
SRC="$WS/vela-src"
cd "$WS/vela"

# 1) esr153 源码树（浅克隆）
if [ ! -d "$SRC" ]; then
  git clone --depth 1 --branch esr153 https://github.com/mozilla-firefox/firefox "$SRC"
fi

# 2) zh-CN 语言树（GitHub 镜像 sparse checkout，省带宽）
mkdir -p "$HOME/.mozbuild/l10n-central"
if [ ! -d "$HOME/.mozbuild/l10n-central/zh-CN" ]; then
  git clone --depth 1 --filter=blob:none --sparse https://github.com/mozilla-l10n/firefox-l10n "$HOME/.mozbuild/l10n-monorepo"
  cd "$HOME/.mozbuild/l10n-monorepo"
  git sparse-checkout set zh-CN
  mv zh-CN "$HOME/.mozbuild/l10n-central/zh-CN"
  cd "$WS/vela"
fi

# 3) overlay 重放（含 mozconfig 拷贝、品牌 rebrand）
"$WS/vela/overlay/apply.sh"
# CI 无 sccache：去掉本地 ccache 配置行
sed -i '' '/--with-ccache=sccache/d' "$SRC/mozconfig" 2>/dev/null || sed -i '/--with-ccache=sccache/d' "$SRC/mozconfig"

# 4) bootstrap（工具链由 mach build 自动按需拉取到 ~/.mozbuild）
cd "$SRC"
./mach --no-interactive bootstrap --application-choice browser
echo "mac setup done"
