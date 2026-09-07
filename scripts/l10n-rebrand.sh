#!/usr/bin/env bash
# Vela l10n 品牌重命名：把 zh-CN 语言树的 UI 文案 Firefox/Nightly → Vela
# 规则：跳过含 "://" 的行（保护 URL）；Mozilla 账号等真服务名不在此列。
# 幂等：l10n-central 重新 fetch 后重跑即可；apply.sh 每次会调用。
set -euo pipefail
L10N="$HOME/.mozbuild/l10n-central/zh-CN"
[ -d "$L10N" ] || { echo "l10n 树不存在：$L10N"; exit 1; }

cd "$L10N"
# perl 逐行处理：不含 :// 的行里替换品牌词
find . -name '*.ftl' -o -name '*.properties' | while read -r f; do
  perl -i -pe 'next if m{://}; s/Firefox/Vela/g; s/Nightly/Vela/g' "$f"
done
echo "l10n 品牌重命名完成（Firefox/Nightly → Vela，URL 保留）"
