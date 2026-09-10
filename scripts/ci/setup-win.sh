#!/usr/bin/env bash
# CI(Windows) 环境准备：源码树 + zh-CN + overlay 重放（git-bash 内运行）
set -euo pipefail
WS="${GITHUB_WORKSPACE:-$(pwd)}"
SRC="$WS/vela-src"
cd "$WS/vela"

if [ ! -d "$SRC" ]; then
  git clone --depth 1 --branch esr153 https://github.com/mozilla-firefox/firefox "$SRC"
fi
mkdir -p "$HOME/.mozbuild/l10n-central"
if [ ! -d "$HOME/.mozbuild/l10n-central/zh-CN" ]; then
  git clone --depth 1 --filter=blob:none --sparse https://github.com/mozilla-l10n/firefox-l10n "$HOME/.mozbuild/l10n-monorepo"
  cd "$HOME/.mozbuild/l10n-monorepo"
  git sparse-checkout set zh-CN
  mv zh-CN "$HOME/.mozbuild/l10n-central/zh-CN"
  cd "$WS/vela"
fi
"$WS/vela/overlay/apply.sh"
# Windows 专用 mozconfig（覆盖 macOS 版：无 mac clang 路径/l10n-base/ccache）
cat > "$SRC/mozconfig" << 'MK'
ac_add_options --enable-application=browser
ac_add_options --with-branding=browser/branding/vela
ac_add_options --enable-optimize
ac_add_options --disable-debug
ac_add_options --disable-crashreporter
ac_add_options --disable-tests
MK
echo "win setup done"
