#!/usr/bin/env bash
# Vela 日常开发一条龙：装语言包（含 dev profile 自愈）→ 启动浏览器
# 用法：cd vela-src && ../vela/scripts/dev-run.sh [额外 URL...]
set -euo pipefail
VELA="$(cd "$(dirname "$0")/.." && pwd)"
"$VELA/scripts/install-langpack.sh"
exec "$VELA-src/mach" run "$@"
