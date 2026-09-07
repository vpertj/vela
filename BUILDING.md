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

## 当前品牌状态与遗留

- ✅ `MOZ_APP_DISPLAYNAME=Vela`，产物为 `dist/Vela.app`
- ⚠️ `MOZ_MACBUNDLE_ID=org.vela.browser` 被 configure 强制加了前缀，实际为 `org.mozilla.org.vela.browser`（toolkit/moz.configure 的前缀策略，M2 决定是否深改）
- ⚠️ 图标仍为 unofficial 占位（Nightly 风格），M2 换正式 Vela 图标
- ✅ `MOZ_APP_ID` 保持 Firefox 官方值（扩展与 profile 兼容，设计文档约定不动）
- 感官验证：用户在自己终端 `cd vela-src && ./mach run` 复验窗口体验
