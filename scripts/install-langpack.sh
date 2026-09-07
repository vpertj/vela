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

# 出厂策略：禁用 Firefox Labs（Nimbus 配方会无视 pref 强制显示实验室菜单项，
# 企业策略 DisableFirefoxLabs 是官方根治通道）
cat > "$APP/distribution/policies.json" << 'POLICY'
{
  "policies": {
    "DisableFirefoxLabs": true
  }
}
POLICY
echo "policies.json 写入（DisableFirefoxLabs）"

# dev profile 自愈：mach build 会清掉 dist 里手工装的 xpi，若窗口期有启动，
# profile 会留下"已装 distro 语言包"标记但扩展库中实际不存在，且不再重装
# （表现为界面回落英文）。这里顺带清标记，保证下次启动必然重装成功。
PROFILE="$OBJ/tmp/profile-default"
if [ -f "$PROFILE/prefs.js" ]; then
  sed -i '' '/installedDistroAddon.langpack-zh-CN/d' "$PROFILE/prefs.js"
fi
