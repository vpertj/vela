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

# en-US 回退源的 GitHub 设置页文案（fluent 属性形式；值形式会让 Fluent
# 清空卡片子元素——坑 28）。幂等：仅在键缺失或为值形式时重写
python3 - "$SRC/browser/locales/en-US/browser/preferences/preferences.ftl" << 'PYFTL'
import sys
p = sys.argv[1]
correct = """
github-sync-group =
    .label = GitHub Sync
github-login-card =
    .label = Sign in with GitHub
    .description = Bookmarks sync to your own private GitHub repository
github-login-button =
    .label = Sign in with GitHub
github-manage-card =
    .label = GitHub sync is ready
    .description = Bookmark changes sync automatically
github-sync-now-button =
    .label = Sync now
github-logout-button =
    .label = Sign out
"""
try:
    s = open(p, encoding="utf-8").read()
except FileNotFoundError:
    sys.exit(0)
lines = correct.strip().split("\n")
# 删除旧的 github-* 条目（连续块或散落），再追加正确块
out, skip = [], False
for line in s.split("\n"):
    if line.startswith("github-"):
        skip = True
        continue
    if skip:
        if line.startswith(" ") or line == "":
            continue
        skip = False
    out.append(line)
s2 = "\n".join(out).rstrip("\n") + "\n\n" + correct.strip() + "\n"
if s2 != s:
    open(p, "w", encoding="utf-8").write(s2)
    print("en-US github ftl rewritten")
PYFTL

# l10n 品牌重命名（幂等；重新 fetch l10n 树后由这里自动补跑）
"$VELA/scripts/l10n-rebrand.sh"

# mozconfig：mach 默认读取源码树根目录的 mozconfig
cp "$VELA/overlay/mozconfig" "$SRC/mozconfig"
echo "overlay applied → $SRC"
