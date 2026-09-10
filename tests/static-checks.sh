#!/usr/bin/env bash
# L1 静态冒烟回归 + L3 品牌扫描（可重复执行）
# 用法：vela/tests/static-checks.sh ；结果输出 stdout（PASS/FAIL 每行一条）
set -u
SRC="/Users/tianjun/Desktop/prog/vela-src"
DIST="$SRC/obj-aarch64-apple-darwin25.6.0/dist/bin"
BR="$SRC/obj-aarch64-apple-darwin25.6.0/dist/Vela.app/Contents/Resources"
PASS=0; FAIL=0
ck() { # ck 名称 期望(1=应存在/0=应不存在) 文件 grep模式
  local name="$1" want="$2" file="$3" pat="$4"
  if [ ! -f "$file" ]; then echo "FAIL [$name] 文件不存在: $file"; FAIL=$((FAIL+1)); return; fi
  if grep -q "$pat" "$file" 2>/dev/null; then
    if [ "$want" = "1" ]; then echo "PASS [$name]"; PASS=$((PASS+1)); else echo "FAIL [$name] 不应存在却存在"; FAIL=$((FAIL+1)); fi
  else
    if [ "$want" = "0" ]; then echo "PASS [$name]"; PASS=$((PASS+1)); else echo "FAIL [$name] 未找到: $pat"; FAIL=$((FAIL+1)); fi
  fi
}
B="$DIST/browser/defaults/preferences/firefox-branding.js"
echo "== L1 静态回归 =="
ck "手势默认关"      1 "$B" 'vela.gestures.enabled", false'
ck "超级拖拽默认开"  1 "$B" 'vela.superdrag.enabled", true'
ck "收藏栏默认隐藏"  1 "$B" 'bookmarks.visibility", "never"'
ck "中文默认"        1 "$B" 'intl.locale.requested", "zh-CN"'
ck "FxA退役"        1 "$B" 'identity.fxaccounts.enabled", false'
ck "OAuth client"   1 "$B" 'Ov23liI2QERC3AZu8mdn'
ck "磁贴本地清单"    1 "$B" 'activity-stream.default.sites'
ck "无遥测首启页"    1 "$B" 'datareporting.policy.firstRunURL", ""'
J="$SRC/browser/base/jar.mn"
ck "framescript注册" 1 "$J" 'vela-framescript.js'
G="$DIST/browser/chrome/browser/content/browser/global-scripts.js"
ck "四脚本加载"      1 "$G" 'vela-github.js'
ck "加载顺序正确"    1 "$G" 'vela-gestures.js'
F="$DIST/browser/chrome/browser/content/browser/vela-framescript.js"
GS="$DIST/browser/chrome/browser/content/browser/vela-gestures.js"
ck "双注入旗标"      1 "$GS" '__velaFramescriptLoaded'
ck "磁贴拦截已移除"  0 "$F" 'top-site-outer'
ck "手势pref门控"    1 "$F" 'gesturesEnabled'
GH="$DIST/browser/chrome/browser/content/browser/vela-github.js"
ck "菜单编程绑定"    1 "$GH" 'bindToolbarMenu'
ck "绑定延到load"    1 "$GH" 'velaBoot'
ck "searchLoginsAsync" 1 "$GH" 'searchLoginsAsync'
ck "无findLogins"    0 "$GH" 'findLogins'
ck "无tm.setTimeout" 0 "$GH" 'Services.tm.setTimeout'
ck "repoPath修正"    1 "$GH" 'return "bookmarks.json";'
ck "GET no-store"    1 "$GH" 'cache: "no-store"'
ck "PlacesObservers" 1 "$GH" 'PlacesObservers.addListener'
ck "无alert"         0 "$GH" 'window.alert('
ck "跨窗口观察者"    1 "$GH" 'vela-github:login'
CK="$DIST/moz-src/browser/components/customizableui/CustomizableUI.sys.mjs"
ck "默认布局登录按钮" 1 "$CK" 'vela-login-button'
ck "v26迁移"         1 "$CK" 'currentVersion < 26'
NT="$DIST/browser/chrome/browser/content/browser/browser.xhtml"
ck "菜单项id"        1 "$NT" 'vela-menu-login'
ck "菜单项fxa隐藏"   1 "$NT" 'fxa-toolbar-menu-button'
MAIN="$DIST/browser/chrome/browser/content/browser/preferences/main.js"
ck "设置卡片条目"    1 "$MAIN" 'createGitHubSyncConfig'
ck "设置无alert"     0 "$MAIN" 'window.alert'
AS="$DIST/browser/chrome/browser/content/browser/preferences/config/account-sync.mjs"
ck "accountDisabled隐藏" 1 "$AS" 'hidden: true,'
CSS="$DIST/browser/chrome/browser/skin/classic/browser/browser.css"
ck "登录按钮图标CSS" 1 "$CSS" 'github-mark.svg'
SVG="$DIST/browser/chrome/browser/content/branding/github-mark.svg"
[ -f "$SVG" ] && echo "PASS [图标资产存在]" && PASS=$((PASS+1)) || { echo "FAIL [图标资产存在]"; FAIL=$((FAIL+1)); }
TABS="$DIST/browser/chrome/browser/content/browser/tabbrowser/tabs.js"
ck "双击关标签"      1 "$TABS" 'removeTab'
UA="$SRC/netwerk/protocol/http/nsHttpHandler.cpp"
ck "UA Vela token"   1 "$UA" 'Vela/'
FTL_EN="$SRC/browser/locales/en-US/browser/preferences/preferences.ftl"
ck "ftl属性形式(en)" 1 "$FTL_EN" 'github-sync-group ='
grep -q '^github-sync-group =    \.label\|^github-sync-group =$' "$FTL_EN" && { echo "PASS [ftl属性形式判定(en)]"; PASS=$((PASS+1)); } || { echo "FAIL [ftl属性形式判定(en)]"; FAIL=$((FAIL+1)); }
LP=$(find "$BR/distribution/extensions" -name "langpack-zh-CN*.xpi" 2>/dev/null | head -1)
if [ -n "$LP" ]; then
  TMP=$(mktemp -d); unzip -qo "$LP" "browser/localization/zh-CN/browser/preferences/preferences.ftl" -d "$TMP" 2>/dev/null
  F2="$TMP/browser/localization/zh-CN/browser/preferences/preferences.ftl"
  grep -A1 '^github-sync-group' "$F2" | grep -q '\.label' && { echo "PASS [ftl属性形式(zh-CN langpack)]"; PASS=$((PASS+1)); } || { echo "FAIL [ftl属性形式(zh-CN langpack)]"; FAIL=$((FAIL+1)); }
  rm -rf "$TMP"
else
  echo "FAIL [langpack存在]"; FAIL=$((FAIL+1))
fi

echo "== L3 品牌零残留扫描（显示层） =="
LP2=$(find "$BR/distribution/extensions" -name "langpack-zh-CN*.xpi" 2>/dev/null | head -1)
TMP3=$(mktemp -d); unzip -qo "$LP2" -d "$TMP3" 2>/dev/null
HITS=$(grep -rn "Mozilla\|Nightly" "$TMP3/localization" 2>/dev/null | grep -v "://\|coverage.json\|# \|mozilla.org" | wc -l | tr -d ' ')
if [ "$HITS" = "0" ]; then echo "PASS [langpack品牌零残留]"; PASS=$((PASS+1)); else echo "FAIL [langpack品牌零残留] 命中 $HITS 处"; grep -rn "Mozilla\|Nightly" "$TMP3/localization" | grep -v "://\|coverage.json\|# \|mozilla.org" | head -5; FAIL=$((FAIL+1)); fi
rm -rf "$TMP3"
echo "== 汇总: PASS=$PASS FAIL=$FAIL =="
