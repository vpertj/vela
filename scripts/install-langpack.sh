#!/usr/bin/env bash
# 把构建出的 zh-CN 语言包装进 dist/Vela.app 的 distribution/extensions
# （发行版内置系统扩展机制：启动自动注册，设置页"语言"里出现简体中文）
# 用法：构建后执行一次；mach package 重打包后需重跑
set -euo pipefail
VELA="$(cd "$(dirname "$0")/.." && pwd)"
OBJ="$VELA-src/obj-aarch64-apple-darwin25.6.0"
XPI=$(ls "$OBJ"/dist/mac/xpi/firefox-*.zh-CN.langpack.xpi 2>/dev/null | head -1)
APP="$OBJ/dist/Vela.app/Contents/Resources"

[ -n "$XPI" ] || { echo "ERROR: langpack xpi 不存在，先跑 ./mach build langpack-zh-CN"; exit 1; }
mkdir -p "$APP/distribution/extensions"
cp "$XPI" "$APP/distribution/extensions/langpack-zh-CN@firefox.mozilla.org.xpi"
echo "langpack 装入 → $APP/distribution/extensions/"
