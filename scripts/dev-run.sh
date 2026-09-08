#!/usr/bin/env bash
# Vela 日常开发一条龙：装语言包（含 dev profile 自愈）→ 启动浏览器
# 用法：cd vela-src && ../vela/scripts/dev-run.sh [额外 URL...]
set -euo pipefail
VELA="$(cd "$(dirname "$0")/.." && pwd)"
"$VELA/scripts/install-langpack.sh"

# dev profile：关崩溃恢复页（dev 期间频繁强杀/重建），不影响正式分发
PROFILE="$VELA-src/obj-aarch64-apple-darwin25.6.0/tmp/profile-default"
if [ -d "$PROFILE" ]; then
  cat > "$PROFILE/user.js" << 'UJ'
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.startup.page", 0);
UJ
fi

exec "$VELA-src/mach" run "$@"
