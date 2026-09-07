#!/usr/bin/env bash
# Vela l10n 品牌重命名（零残留版）：zh-CN 语言树 UI 文案品牌词 → Vela
# 规则：
#   - 跳过含 "://" 的行（保护 URL）
#   - 跳过含 "Public License" 的行（MPL 许可证法律名称必须保留）
#   - 跳过注释行（ftl 的 #/## 开头、properties 的 # 开头——不渲染）
#   - 替换：Firefox / Mozilla / Nightly / 火狐 → Vela
# 幂等：l10n-central 重新 fetch 后重跑；apply.sh 每次调用。
set -euo pipefail
L10N="$HOME/.mozbuild/l10n-central/zh-CN"
[ -d "$L10N" ] || { echo "l10n 树不存在：$L10N"; exit 1; }

cd "$L10N"
find . \( -name '*.ftl' -o -name '*.properties' -o -name '*.dtd' -o -name '*.ini' \) | while read -r f; do
  perl -i -pe '
    next if m{://};
    next if /Public License/;
    next if /^\s*#/;           # ftl/properties 注释
    s/Firefox/Vela/g;
    s/Mozilla/Vela/g;
    s/Nightly/Vela/g;
    s/火狐/Vela/g;
  ' "$f"
done
echo "l10n 品牌重命名完成（Firefox/Mozilla/Nightly/火狐 → Vela；URL 与许可证名保留）"
