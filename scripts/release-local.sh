#!/usr/bin/env bash
# 本机构建 DMG 并发布 GitHub Release（无需 Actions，走你已验证的本地管线）
# 用法：vela/scripts/release-local.sh [标签名，默认 v<应用版本>]
# 前置：gh 已登录；完整构建约 62 分钟（增量则快）
set -euo pipefail
VELA="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${VELA}-src"
OBJ="$SRC/obj-aarch64-apple-darwin25.6.0"

cd "$SRC"
"$VELA/overlay/apply.sh"
./mach build
./mach build langpack-zh-CN
./mach package
"$VELA/scripts/install-langpack.sh"

VER=$(grep '^Version=' "$OBJ/dist/bin/application.ini" | cut -d= -f2)
TAG="${1:-v$VER}"
DMG="Vela-${VER}-macOS-arm64.dmg"

# ad-hoc 签名减轻 Gatekeeper 报错
codesign --force --deep --sign - "$OBJ/dist/Vela.app" || true
rm -f "$OBJ/dist/$DMG"
hdiutil create -volname "Vela" -srcfolder "$OBJ/dist/Vela.app" -ov -format UDZO "$OBJ/dist/$DMG"
cp "$OBJ/dist/$DMG" "/tmp/$DMG"
XPI=$(find "$OBJ/dist/mac/xpi" -name "*zh-CN.langpack.xpi" | head -1)
cp "$XPI" "/tmp/Vela-zh-CN-langpack.xpi" 2>/dev/null || true

cd "$VELA"
if gh release view "$TAG" > /dev/null 2>&1; then
  gh release upload "$TAG" "/tmp/$DMG" --clobber
else
  gh release create "$TAG" "/tmp/$DMG" \
    --title "Vela $TAG (macOS)" \
    --notes "Vela 浏览器 macOS arm64 构建（含简体中文语言包）。
- 首次打开：右键 Vela.app → 打开（未签名构建）
- 语言包已内置，界面默认简体中文"
fi
[ -f "/tmp/Vela-zh-CN-langpack.xpi" ] && gh release upload "$TAG" "/tmp/Vela-zh-CN-langpack.xpi" --clobber || true
echo "Release 完成：https://github.com/vpertj/vela/releases/tag/$TAG"
