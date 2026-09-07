# Vela 构建指南（macOS，M1 实测）

> 实测环境：MacBook arm64（darwin 25.6.0）、16GB 内存、macOS 完整版 Xcode、磁盘可用 708GB。
> 基线：[mozilla-firefox/firefox](https://github.com/mozilla-firefox/firefox) 官方 git 仓库 `esr153` 分支（Firefox 153.3.0 ESR，5 年支持承诺，2026-07-21 发布）。

## 磁盘与耗时实测（2026-09-07）

| 阶段 | 实测耗时 | 磁盘占用 |
|---|---|---|
| 浅克隆源码（--depth 1 --single-branch） | ~3 分钟 | 5.5GB（vela-src/） |
| 工具链下载（clang/wasi 等，手动 artifact） | ~5 分钟 | 2.5GB（~/.mozbuild/） |
| mach configure | <1 分钟 | — |
| **全量构建（opt，-j10）** | **62 分钟** | 12GB（obj-aarch64-…/） |
| **增量构建（touch browser.xhtml 后）** | **18.6 秒** | — |
| 产物 Vela.app | — | 266MB |

> 16GB 内存注意：全量构建的 gkrust LTO 链接阶段单进程吃 ~3.2GB 内存并占满单核 20-30 分钟（toolkit/library/rust 合成 LTO 静态库），期间构建日志长时间无输出属正常，勿误判卡死。

## 标准工作流（日常迭代）

```bash
# 1. 改 vela/overlay/ 下的品牌/UI 文件（browser 子树只放 vela 专属目录）
vim vela/overlay/browser/branding/vela/configure.sh

# 2. 应用 overlay 到源码树（幂等）
vela/overlay/apply.sh

# 3. 增量构建 + 启动（源码树目录）
cd ../vela-src && ./mach build && ./mach run
```

## 环境从零重建（完整步骤）

```bash
# 源码（浅克隆；跟上游补丁时 git fetch --depth 1 origin esr153 后对比）
cd ~/Desktop/prog
git clone --depth 1 --single-branch -b esr153 \
  https://github.com/mozilla-firefox/firefox vela-src

# 工具链：本机 bootstrap 是"薄检查"，必须手动补齐三件
cd vela-src
# ① arm64 版 Mozilla clang（注意：任务名带 aarch64 才是 arm64；macosx64-clang 是 x86_64）
./mach artifact toolchain --from-build macosx64-aarch64-clang-21
rm -rf ~/.mozbuild/clang && mv clang ~/.mozbuild/clang
# ② wasi sysroot（RLBox 沙箱）
./mach artifact toolchain --from-build sysroot-wasm32-wasi-clang-21
mv sysroot-wasm32-wasi ~/.mozbuild/
# ③ wasi compiler-rt
./mach artifact toolchain --from-build wasm32-wasi-compiler-rt-21
mv compiler-rt-wasm32-wasi ~/.mozbuild/
# ④ cbindgen（cargo 装，进 ~/.cargo/bin）
cargo install cbindgen

# 配置（Vela overlay：品牌目录 + mozconfig 已固化 clang 路径）
~/Desktop/prog/vela/overlay/apply.sh
./mach configure

# 构建
./mach build
```

## 踩坑记录（按时间序，全部实测踩过）

1. **`./mach bootstrap --no-interactive` 不存在**：该参数是全局参数须放 bootstrap 前；且本机 bootstrap 是薄检查（验完系统 Rust 就退出），不会装 clang/wasi，靠上面手动三件补齐。
2. **bootstrap 菜单非 TTY 不读管道 stdin**：`printf '2\n' | ./mach bootstrap` 无效，非交互一律选默认项（默认是 Artifact Mode，不是我们要的完整构建）。正确姿势是 `--application-choice browser`，但依然只做薄检查。
3. **`macosx64-clang` 是 x86_64 二进制**：在 arm64 Mac 上靠 Rosetta 能跑 clang --version 但 libclang.dylib dlopen 失败（报 "libclang too old"，实为架构不符）。必须用 `macosx64-aarch64-clang-21`。
4. **artifact toolchain 解压到 cwd**：下载的 tar 解压在源码树根目录，需手动 mv 到 `~/.mozbuild/<标准名>`（configure 用 `bootstrap_path()` 按目录名查找）。
5. **`./mach run -headless` 报错**：mach 把单横线参数拦截成 `-h`，必须 `--headless --no-remote`。
6. **overlay 同步事故教训**：apply.sh 曾对整棵 `browser/` 用 `rsync --delete`，把上游 browser/ 源码删得只剩 branding（configure 报 "Cannot find project browser"）。已修复为只对 `browser/branding/vela/` 子树同步。源码树在 git 管理下，`git checkout -- browser/` 可完整恢复。
7. **mach run 静默退出的两连坑（2026-09-07 启动不了排查实录）**：
   - 坑 A：Vela 的实例 remoting 名默认是 `firefox`，与用户日常开着的官方 Firefox 同名——启动请求被转发给它后自退。修复：branding 加 `MOZ_APP_REMOTINGNAME=vela`（aurora 品牌同款机制）。
   - 坑 B（真凶）：**自动化测试留下的孤儿 Vela 实例**（后台 GUI 测试杀 shell 不杀进程树，窗口在自动化会话里又不可见）一直占着 `vela` 实例名——此后所有 `./mach run` 都静默转发给它，秒退、无窗口、退出码 0、无 crash 报告。诊断命令：`ps aux | grep 'Vela.app/Contents/MacOS'`；清理：`pkill -f 'Vela.app/Contents/MacOS'`（精确路径匹配，不伤用户 /Applications/Firefox.app）。**教训：自动化跑 GUI 测试后必须精确清理进程树，否则占用实例名造成"启动不了"假象。**
8. **mach build 会清掉 dist/.app 里手工放置的文件**（如 distribution/extensions 的 langpack）——每次 build 后必须重跑 `scripts/install-langpack.sh`。

## 当前品牌状态与遗留

- ✅ `MOZ_APP_DISPLAYNAME=Vela`，产物为 `dist/Vela.app`
- ✅ 竖向标签栏出厂默认（`sidebar.verticalTabs=true`，M2 第一刀）
- ✅ 出厂简体中文：zh-CN langpack 内置于 `distribution/extensions/` + `intl.locale.requested=zh-CN`；en-US 为内置基准，设置页"语言"可切换（ESR 构建 `intl.multilingual` 默认开启）
- ⚠️ `MOZ_MACBUNDLE_ID=org.vela.browser` 被 configure 强制加了前缀，实际为 `org.mozilla.org.vela.browser`（toolkit/moz.configure 的前缀策略，M2 决定是否深改）
- ⚠️ 图标仍为 unofficial 占位（Nightly 风格），M2 换正式 Vela 图标
- ✅ `MOZ_APP_ID` 保持 Firefox 官方值（扩展与 profile 兼容，设计文档约定不动）
- 感官验证：用户在自己终端 `cd vela-src && ./mach run` 复验窗口体验

## 本地化（zh-CN）流程

```bash
# 一次性：拉取与 esr153 对齐的语言资源（revision 来自 browser/locales/l10n-changesets.json）
mkdir -p ~/.mozbuild/l10n-central && cd ~/.mozbuild/l10n-central
git init && git remote add origin https://github.com/mozilla-l10n/firefox-l10n.git
git fetch --depth 1 origin b5a42a3462bb1c2fb2efbc442518034d07fc56a7
git checkout FETCH_HEAD   # monorepo：各语言是根下子目录（zh-CN/ 等）

# 日常（已在 overlay/mozconfig 固化 --with-l10n-base）：
cd vela-src
./mach build langpack-zh-CN                       # 产出 dist/mac/xpi/*.langpack.xpi
/Users/tianjun/Desktop/prog/vela/scripts/install-langpack.sh   # 装进 Vela.app distribution/extensions
# 出厂默认语言已固化在 overlay pref：intl.locale.requested=zh-CN
```

注意：改 mozconfig（含 --with-l10n-base）会触发约 20 分钟的大范围重编；纯 pref/CSS 改动仍为 18 秒级增量。

### 本地化补坑（2026-09-07 下午实录）

9. **langpack 签名检查导致默认语言回落英文**：`extensions.langpacks.signatures.required` 默认 true（firefox.js），自构建未签名 langpack 被拒绝装载 → `intl.locale.requested=zh-CN` 找不到资源静默回落 en-US。修复：branding pref 覆盖为 false（自构建自分发场景）。
10. **品牌文案藏在 langpack 里，改 brand.ftl 必须重编 langpack**：`browser/branding/vela/locales/en-US/brand.ftl` 的品牌词（原 Nightly→Vela）会在 `mach build langpack-zh-CN` 时编译进语言包——只跑 `mach build` 不重编 langpack 的话界面品牌词不变。正确顺序：改 ftl → `mach build` → `mach build langpack-zh-CN` → `scripts/install-langpack.sh`（三步缺一不可，build 还会清掉 dist 里手工装的 xpi）。
11. 已知残留：设置页"Firefox 实验室"等 toolkit 层写死 Firefox 字样的 langpack 翻译，属深度品牌清理项（patch langpack ftl），排 M2 尾。
12. **旧 profile 的 langpack 一次性安装标记**：profile 首启时会安装 distribution 语言包并写入 `extensions.installedDistroAddon.langpack-*` 标记（一次性，防重装）。若首启发生在 langpack 被签名检查拒绝的旧 app 下，标记照样写入且之后**不再重试**——修复 app 后该 profile 永远英文。症状：新 profile 中文、旧 profile 英文。修复：删 profile 的 prefs.js 中 `installedDistroAddon.langpack-*` 行后重启。真实分发不受影响（用户首启即修复后的 app）。
