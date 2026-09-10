#!/usr/bin/env bash
# CI(macOS)：构建 + 打包 DMG（含 zh-CN 语言包）
set -euo pipefail
WS="${GITHUB_WORKSPACE:-$(pwd)}"
SRC="$WS/vela-src"
cd "$SRC"
./mach build
./mach build langpack-zh-CN
./mach package

OBJ="$SRC/obj-aarch64-apple-darwin25.6.0"
[ -d "$OBJ" ] || OBJ=$(ls -d "$SRC"/obj-* | head -1)

# 语言包装进 app
XPI=$(find "$OBJ/dist/mac/xpi" -name "*zh-CN.langpack.xpi" | head -1)
mkdir -p "$OBJ/dist/Vela.app/Contents/Resources/distribution/extensions"
cp "$XPI" "$OBJ/dist/Vela.app/Contents/Resources/distribution/extensions/langpack-zh-CN@firefox.mozilla.org.xpi"

# ad-hoc 签名（减轻 Gatekeeper 报错；正式分发需开发者证书）
codesign --force --deep --sign - "$OBJ/dist/Vela.app" || true

# 自制 DMG
VER=$(grep '^Version=' "$OBJ/dist/bin/application.ini" | cut -d= -f2)
DMG="Vela-${VER}-macOS-arm64.dmg"
rm -f "$OBJ/dist/$DMG"
hdiutil create -volname "Vela" -srcfolder "$OBJ/dist/Vela.app" -ov -format UDZO "$OBJ/dist/$DMG"
echo "DMG=$OBJ/dist/$DMG" >> "$GITHUB_OUTPUT" 2>/dev/null || true
cp "$OBJ/dist/$DMG" "$WS/vela/$DMG"
cp "$XPI" "$WS/vela/Vela-zh-CN-langpack.xpi" 2>/dev/null || true
echo "mac build done: $DMG"
