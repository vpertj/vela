#!/usr/bin/env bash
# Vela l10n 品牌重命名（外科手术版 v3）：只替换"值"，绝不动键名
# 目标：~/.mozbuild/l10n-central/zh-CN + vela-src 的 en-US 回退源
# 规则：跳过 URL 行 / MPL 许可证行 / 注释行；首个 = 右侧才做替换；
#       无 = 的续行（前导空格）整行替换；Firefox/Mozilla/Nightly/火狐 → Vela
set -euo pipefail
VELA="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${VELA}-src"
export SRC

python3 - << 'PYEOF'
import os, re, pathlib
PAT = re.compile(r'Firefox|Mozilla|Nightly|火狐')
def process(path):
    p = pathlib.Path(path)
    try:
        lines = p.read_text(encoding='utf-8').splitlines(keepends=True)
    except (UnicodeDecodeError, IsADirectoryError):
        return
    out, changed = [], False
    for line in lines:
        body = line.rstrip('\r\n')
        eol = line[len(body):]
        if '://' in body or 'Public License' in body or body.lstrip().startswith('#'):
            out.append(line); continue
        if '=' in body:
            k, _, v = body.partition('=')
            nv = PAT.sub('Vela', v)
            if nv != v: changed = True
            out.append(k + '=' + nv + eol)
        elif body.startswith((' ', '\t')):  # ftl 续行（值的一部分）
            nv = PAT.sub('Vela', body)
            if nv != body: changed = True
            out.append(nv + eol)
        else:
            out.append(line)
    if changed:
        p.write_text(''.join(out), encoding='utf-8')

roots = [os.path.expanduser('~/.mozbuild/l10n-central/zh-CN'),
         os.environ['SRC'] + '/browser/locales/en-US',
         os.environ['SRC'] + '/toolkit/locales/en-US']
n = 0
for root in roots:
    if not os.path.isdir(root): continue
    for dirpath, _, files in os.walk(root):
        for f in files:
            if f.endswith(('.ftl', '.properties')):
                process(os.path.join(dirpath, f)); n += 1
print(f"rebrand 完成：处理 {n} 个文件（zh-CN + en-US 回退源）")
PYEOF
