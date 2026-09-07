# M1 桌面底座 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 macOS 上从源码构建出可启动的 Vela 桌面浏览器（白牌 Firefox 状态：Vela 名称+占位图标，无任何交互改动）。

**Architecture:** mozilla 源码树独立放在 `vela-src/`（浅克隆，不进 vela 仓库）；vela 仓库只存差异层（`overlay/` 品牌文件 + mozconfig + 应用脚本 + 文档），用 `overlay/apply.sh` 同步进源码树。这是"M1 轻仓库 + 源码树就地构建"的双目录结构。

**Tech Stack:** Mozilla mach 构建系统（Python 驱动）、官方 git 仓库 mozilla-firefox/firefox、Gecko/GeckoView 引擎源、macOS Xcode 工具链 + ~/.mozbuild 工具链。

## Global Constraints

- 源码源：`https://github.com/mozilla-firefox/firefox`（Mozilla 2025 年完成 hg→git 迁移后的官方仓库；旧镜像 mozilla/gecko-dev 已废弃，勿用）
- 基线分支：`esr153`（2026-07-21 发布的当前主 ESR，Mozilla 承诺 5 年支持；esr140 处于退役过渡期，勿选）
- 源码树路径：`/Users/tianjun/Desktop/prog/vela-src`；vela 仓库路径：`/Users/tianjun/Desktop/prog/vela`
- 不改 `MOZ_APP_ID`（Firefox 的 `{ec8030f7-...}` GUID，动它会破坏扩展兼容与 profile 识别）；M1 只改显示名与品牌目录
- vela 仓库禁止提交：源码树本体、构建产物（obj-*、dist）、日志（logs/ 目录 gitignore）
- 本机基线（已核实）：macOS darwin 25.6 arm64、Xcode 完整版（/Applications/Xcode.app）、Python 3.9.6、git 2.50.1、磁盘可用 708GB
- GUI 感官验证交给用户终端执行（自动化会话中完整 GUI 窗口可能不显示，不得据此判定失败）；自动化会话只验证到"进程启动不崩"
- 所有长任务（clone/bootstrap/build）后台执行 + 日志落盘，便于跨会话续跑

---

### Task 1: 浅克隆 ESR 源码树

**Files:**
- Create: `/Users/tianjun/Desktop/prog/vela-src/`（git 浅克隆，约 1.5-2.5GB）
- Create: `vela/.gitignore`（logs/ 与本地产物）

**Interfaces:**
- Produces: `vela-src/mach`（构建入口脚本）、`vela-src/browser/`（后续所有品牌改造的目标树）

- [x] **Step 1: vela 仓库加 .gitignore**

```gitignore
logs/
*.log
.DS_Store
```

- [x] **Step 2: 后台浅克隆（--depth 1 省掉数 GB 历史）**

```bash
cd /Users/tianjun/Desktop/prog
git clone --depth 1 --single-branch -b esr153 \
  https://github.com/mozilla-firefox/firefox vela-src \
  2>&1 | tee vela/logs/clone.log
```

预估 5-25 分钟（视网络）。后续跟上游补丁：`git fetch --depth 1 origin esr153 && git reset --hard origin/esr153`（品牌层是 overlay 重放，不依赖 git 历史）。

- [x] **Step 3: 验证**

```bash
test -x vela-src/mach && echo MACH_OK
cat vela-src/browser/config/version.txt        # 期望 153.x.y
git -C vela-src log -1 --format='%h %cd %s'    # 期望 esr153 近期提交
```

### Task 2: mach bootstrap（构建工具链）

**Files:**
- Create: `~/.mozbuild/`（clang、node、sccache、wasm 工具链等，约 3-5GB）

**Interfaces:**
- Consumes: `vela-src/mach`
- Produces: 可用的构建工具链（后续 `./mach build` 依赖）

- [x] **Step 1: 后台跑 bootstrap，选 Firefox for Desktop**

```bash
cd /Users/tianjun/Desktop/prog/vela-src
./mach bootstrap 2>&1 | tee ../vela/logs/bootstrap.log
```

交互菜单出现时选 **Firefox for Desktop Aurora/Release（桌面浏览器）** 那一项；询问是否安装 ccache/sccache 一律 y。预估 15-40 分钟。若非交互环境卡菜单：改用 `printf '2\ny\ny\n' | ./mach bootstrap`（序号以菜单实际显示为准）。

- [x] **Step 2: 验证**

```bash
test -x ~/.mozbuild/clang/bin/clang && echo CLANG_OK
./mach doctor 2>&1 | tail -20    # 无 fatal 即可
```

### Task 3: Vela 品牌层 + mozconfig + configure

**Files:**
- Create: `vela/overlay/browser/branding/vela/`（品牌目录，复制自源码树 `browser/branding/unofficial/` 后改）
- Create: `vela/overlay/apply.sh`（overlay → 源码树 同步脚本）
- Create: `vela/overlay/mozconfig`（并软链/复制到 vela-src/）
- Modify: 源码树 `vela-src/mozconfig`（mach 默认读取路径）

**Interfaces:**
- Consumes: Task 1 的源码树、Task 2 的工具链
- Produces: `browser/branding/vela`（ MOZ_APP_DISPLAYNAME=Vela ）、可 configure 的 mozconfig；apply.sh 被 Task 4/6 复用

- [x] **Step 1: 复制 unofficial 品牌目录为 vela**

```bash
cd /Users/tianjun/Desktop/prog
cp -R vela-src/browser/branding/unofficial vela/overlay/browser/branding/vela
```

- [x] **Step 2: 改显示名为 Vela**

查看 `vela/overlay/browser/branding/vela/configure.sh`，把显示名相关键改为：

```sh
MOZ_APP_DISPLAYNAME=Vela
MOZ_APP_PROFILE=vela        # 若存在此键（profile 目录名，避免与官方 Firefox 共存冲突）
MOZ_APP_VENDOR=VelaProject  # 若存在此键
```

macOS bundle 名与 id：若源码树 `browser/branding/vela/configure.sh` 含 `MOZ_MACBUNDLE_ID`，改为 `org.vela.browser`；不含则 M1 接受默认（bundle id 留 Mozilla 默认，M2 再改，避免一次改太多无法定位构建问题）。

- [x] **Step 3: 写 overlay/apply.sh**

```bash
#!/usr/bin/env bash
# 把 vela 仓库的 overlay 层同步进源码树（幂等，可重复执行）
set -euo pipefail
VELA="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${VELA}-src"
rsync -a --delete "$VELA/overlay/browser/" "$SRC/browser/"
cp "$VELA/overlay/mozconfig" "$SRC/mozconfig"
echo "overlay applied → $SRC"
```

- [x] **Step 4: 写 overlay/mozconfig**

```sh
# Vela M1 桌面构建配置（macOS）
ac_add_options --enable-application=browser
ac_add_options --with-branding=browser/branding/vela
ac_add_options --enable-optimize
ac_add_options --disable-debug
ac_add_options --disable-crashreporter
ac_add_options --disable-tests
ac_add_options --with-ccache=sccache
mk_add_options AUTOCLOBBER=1
```

- [x] **Step 5: 应用 overlay 并 configure**

```bash
chmod +x vela/overlay/apply.sh && vela/overlay/apply.sh
cd vela-src && ./mach configure 2>&1 | tee ../vela/logs/configure.log
```

- [x] **Step 6: 验证**

configure 退出码 0；`grep -r "Vela" vela-src/obj-*/config/mozconfig.txt` 能看到品牌项生效。

### Task 4: 全量构建

**Files:**
- Create: `vela-src/obj-*/`（构建目录 + dist 产物，20-40GB，gitignore 范畴外——源码树本身就不入库）

**Interfaces:**
- Consumes: Task 2 工具链 + Task 3 mozconfig/品牌层
- Produces: `vela-src/obj-*/dist/Vela.app`（名称以 branding 产物为准）

- [x] **Step 1: 后台全量构建**

```bash
cd vela-src && ./mach build 2>&1 | tee ../vela/logs/build-full.log
```

预估 1-2.5 小时（arm64 首建）。失败时读 build-full.log 尾部定位，修复后重跑（mach 增量续跑）。

- [x] **Step 2: 验证**

```bash
ls vela-src/obj-*/dist/ | head
test -d vela-src/obj-*/dist/*.app && echo APP_OK   # .app 名含 Vela 为品牌生效
du -sh vela-src/obj-*                              # 记录实测磁盘占用
```

### Task 5: 启动验证 + 增量构建验证

**Files:** 无新文件；产出验证记录（写入 Task 6 的 BUILDING.md）

**Interfaces:**
- Consumes: Task 4 的 .app
- Produces: 启动验证结论 + 增量构建实测耗时

- [x] **Step 1: mach run 启动（自动化会话只验"进程不崩"）**

```bash
cd vela-src && timeout 25 ./mach run 2>&1 | tail -30
```

进程存活 25s 且无 fatal/crash 即通过；窗口感官体验由用户在自己终端执行 `./mach run` 复验。

- [x] **Step 2: 增量构建验证**

```bash
touch vela-src/browser/base/content/browser.xhtml
cd vela-src && time ./mach build 2>&1 | tail -5
```

期望 <10 分钟完成（实测值记录入 BUILDING.md）。

### Task 6: 文档与收尾入库

**Files:**
- Create: `vela/BUILDING.md`（构建环境+各阶段实测耗时+磁盘占用+踩坑记录）
- Create: `vela/logs/.gitkeep`（logs 目录占位但内容不入库）

**Interfaces:**
- Consumes: Task 1-5 全部实测数据
- Produces: 可交接的构建知识库（M2 及 Windows 构建都会引用）

- [x] **Step 1: 写 BUILDING.md**（模板骨架：环境矩阵/源码获取/bootstrap/mozconfig/构建/启动/增量/踩坑各节，全部填实测值，不留 TBD）

- [x] **Step 2: commit + push**

```bash
cd vela && git add -A && git commit -m "feat(m1): 桌面底座——overlay 品牌层/mozconfig/apply 脚本/BUILDING 文档" && git push
```

---

## Self-Review

- 覆盖 spec M1 范围：源码获取(T1)、bootstrap(T2)、品牌(T3)、全量+增量构建与启动(T4/T5)、文档入库(T6) ✓
- spec 开放问题全部解答并体现：git 官方仓库+esr153（对比 mozilla-unified hg）、品牌走 branding 目录+不动 MOZ_APP_ID ✓
- 无占位符；品牌键值给了目标值与"执行时确认存在性"的判定规则 ✓
- 类型/路径一致：vela-src、overlay/apply.sh、logs/ 全文一致 ✓

## 执行方式

Inline（superpowers:executing-plans）：小时级后台构建需要在会话内持续管理（tail 日志、断点续跑、跨任务检查点），subagent 每任务新上下文不适合长构建场景。
