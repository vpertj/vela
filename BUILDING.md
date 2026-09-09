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
13. **mach build 与 langpack 的窗口期坑（dev 工作流）**：`mach build` 会清掉 dist/.app 里手工装的 langpack xpi；若在"build 后、install-langpack 前"启动过浏览器，profile 会留下 distro 安装标记而扩展库中实际不存在，防重装机制导致此后永远英文（新 profile 不受影响）。**日常开发请统一用 `vela/scripts/dev-run.sh`**（装语言包 + 清失效标记 + mach run 一条龙）。
14. **上游文件修改流程纪律**：凡收编进 `overlay/upstream/` 的文件（browser.css、tabs.js 等），**必须先改 overlay 里的副本再跑 apply.sh**——直接改 vela-src 里的文件会在下一次 apply 时被 overlay 旧版覆盖（2026-09-07 静海第二批 CSS 曾因此整段丢失）。
15. **验证清理纪律（误杀用户实例教训）**：自动化验证后清理测试实例，**严禁 `pkill -f 'Vela.app'` 宽匹配**——用户日常就开着 Vela 时会被误杀 → profile 被标记崩溃 → 用户下次启动反复见"恢复浏览状态"页。正确做法：只按测试 profile 路径精确匹配（如 `pkill -f '/tmp/vela-'`）或记录测试 PID 精确 kill。用户 profile 出现恢复页时：删 profile 根的 sessionstore.jsonlz4、sessionCheckpoints.json 与 sessionstore-backups/ 残留即可。

### 品牌清零专项（2026-09-07 晚）

- **UA 标识**：`overlay/upstream/netwerk/protocol/http/nsHttpHandler.cpp` 的 `BuildUserAgent()` 末尾追加 ` Vela/<版本>`（Zen/Brave 同款 append 模式，Firefox 兼容段完整保留）。实测 UA：`Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:153.0) Gecko/20100101 Firefox/153.0 Vela/153.3.0`。C++ 改动增量构建约 21 秒（只重编该文件+重链 XUL）。
- **l10n 文案修正机制**：`overlay/l10n/zh-CN/<路径>` 收编改过的翻译文件，apply.sh 第三段 rsync 进 `~/.mozbuild/l10n-central/zh-CN/` → 改后必须重跑 `mach build langpack-zh-CN` + install-langpack。已改：`toolkit/toolkit/branding/brandings.ftl` 的 `-firefoxlabs-brand-name = Vela 实验室`。
- **正式图标**：/tmp/vela-icon.swift 用 CoreGraphics 程序化绘制（靛青 #3563E9 squircle 底 + 白色几何帆 + 速度线）→ iconset/iconutil 成 icns，已替换 branding/vela 全套（firefox/disk/document.icns + default*.png）。生成脚本未入库，图标产物已入 overlay。
16. **实验室（Labs）菜单项隐藏**：`browser.preferences.experimental.hidden` pref 会被 firefoxLabs.mjs 的 Nimbus 配方逻辑无视并改写（有可用配方即强制显示）。根治 = `distribution/policies.json` 的 `DisableFirefoxLabs: true`（官方企业策略），已固化进 install-langpack.sh（mach build 会清 dist，该脚本每次重写）。
17. **profile 内 distro langpack 不随 dist 更新**：distribution 扩展机制是一次性安装（首启装入 profile 后，dist 里 xpi 更新不会同步到已装版本）——文案类改进对旧 profile 无效。dev 验收遇"文案还是旧的"：删 `obj-*/tmp/profile-default` 重建即装新版。"Mozilla 产品"菜单与实验室同源（Nimbus），已用 `DisableMoreFromMozilla` 策略一并禁用。
18. **品牌零残留基线（2026-09-07）**：l10n-rebrand.sh 升级为四词替换（Firefox/Mozilla/Nightly/火狐→Vela，跳过 URL/MPL 许可证名/注释行）+ app brand.ftl 的 product-name/vendor-name 修正。终扫显示层（ftl/properties/dtd 非注释非 URL）= 0 处。coverage.json 里的字符串 ID 属元数据不显示。已知残余风险：zh-CN 缺翻译时回退英文原文（含 Firefox），遇一处点杀一处（补 zh-CN 覆盖或改 en-US 源）。

### M3 鼠标手势（2026-09-07）

- 架构：`browser/base/content/vela-gestures.js`（chrome 侧，window.messageManager 注册）+ data-URL frame script（内容进程捕获鼠标，多进程下内容事件不冒泡到 chrome 的标准解法）；注册点 = `jar.mn` 文件清单 + `global-scripts.js` loadSubScript（三处都已 overlay 收编）。
- 手势表：←后退 →前进 ↓关闭 ↑↓刷新 ↓→恢复标签；轨迹靛青 polyline。
- 坑：window 脚本的 `Services` 是精简版——`Services.ppmm` 不存在、`resource://gre/modules/Services.sys.mjs` 不存在（esr153 Services 为全局注入）；正解 = `window.messageManager`（loadFrameScript + addMessageListener 均在 window 域）。
- **操作纪律：在 vela-src 目录跑 git 命令前先确认 cwd**——vela-src 的 git 是 Mozilla 上游仓库，误 commit 后 `git reset HEAD~1` 撤销（2026-09-07 实际发生过，push 被上游 403 拒下）。

### 启航页品牌资产与默认磁贴（2026-09-07 夜）

- **Nightly 图片资产根修**：字符串扫描扫不到的残留=图片资产——`branding/vela/content/` 的 about-logo.png/@2x、about-logo-private、about.png（Nightly 球）与 about-wordmark.svg/firefox-wordmark.svg（路径烘焙的"Nightly"文字图形）。已用 CoreGraphics 生成的 Vela 帆图标全套替换，wordmark 重写为 SVG `<text fill="context-fill">`（注意：**newtab 实际引用的是 firefox-wordmark.svg**，about-wordmark.svg 改完必须同步拷贝，2026-09-07 踩过）。
- **默认磁贴三重坑**：esr153 topsites 默认源优先级 = `browser.topsites.useRemoteSetting`(true 时从 Mozilla RemoteSettings 在线拉，本地改什么都没用) → `browser.newtabpage.activity-stream.default.sites` 覆写 pref（注意不是废弃的 browser.newtabpage.default.sites）→ DefaultSites.sys.mjs 硬编码（已 overlay 收编改大陆站）。出厂三件套：useRemoteSetting=false + override pref 设中文站 + DefaultSites 补丁（防御性）。
- **遥测告知条**：datareporting.policy.firstRunURL 置空只防开页，顶部告知条要 `datareporting.policy.dataSubmissionPolicyBypassNotification=true`。
- 磁贴标签首启显示主机名（zhihu/bilibili），访问一次后自动换成站点标题——正常行为。
19. **dev 工作流的"恢复浏览状态"页**：dev 期间频繁强杀/重建实例 → profile 崩溃标记 → 每次启动弹恢复页。根治 = dev profile 的 user.js 写 `browser.sessionstore.resume_from_crash=false`（dev-run.sh 已自动化；user.js 优先级最高且只影响该 profile，正式分发不受影响）。终端里的 JS warning 是网页脚本自己的报错（B 站统计/淘宝风控），mach run 开发模式回显 stderr 所致，正式版无终端不可见，非产品缺陷。

### M3 超级拖拽（2026-09-07 夜）

- 架构同手势：`vela-superdrag.js`（chrome 侧）+ data-URL frame script（内容进程）。注册点与手势同两处（global-scripts.js + jar.mn）。
- 判定核心：`dragstart` 记录来源（`closest("a[href]")` → link，否则选区 text/plain → text，截断 512 字符）；`dragend` 且 `dropEffect === "none"`（没落到任何可放置目标）才触发——拖到收藏栏/地址栏等正常目标走原生拖放，不冲突。
- 执行：link → `openLinkIn(url, "tab", {inBackground:true, triggeringPrincipal: browser.contentPrincipal})`；text → `Services.search.getDefault()` → `engine.getSubmission()` → `openTrustedLinkIn`（前台标签）。pref 开关 `vela.superdrag.enabled`。

### P0 品牌资产清零（2026-09-08 晨）

- **狐狸贴图体系**（字符串扫描永远扫不到的图片残留）：设置页默认浏览器卡片 = `toolkit/themes/shared/illustrations/kit-happy.svg`/`kit-concerned.svg`（window.createDefaultBrowserConfig 的 imagesrc）；AI 控制图标 = `browser/themes/shared/preferences/fox-ai.svg`；侧栏 = `sidebar/foxy.svg`+`sidebar/firefox.svg`；账号头像 = `fxa/avatar-fox(.circle).svg`；私密页 = `privatebrowsing/pbm-logo.svg`+`fox-tail.svg`；tab 图标 = `icons/privateBrowsing.svg`（context-fill 适配主题）。全部已 overlay/upstream 收编替换为 Vela 帆体系。
- **"实验室"菜单（二次反击战）**：policies.json 的 DisableFirefoxLabs 在 esr153 schema **不存在**（FirefoxLabs/MoreFromMozilla 只是 UserMessaging 策略的子开关），非法策略被整文件拒绝→labs 复现。且 policies.json 存在本身触发"组织管理"横幅。终解：**撤 policies.json**（横幅消失）+ 代码级双补丁：preferences.js `visible: () => false`（新导航系统 line 434，旧路径 578 是无效补丁点）+ firefoxLabs.mjs `let shouldHide = true`（Nimbus 有配方也强制隐藏）。
- **教训：菜单可见性有两套系统**（旧 getElementById.hidden + 新 SettingPaneManager visible 回调），只补一处无效。
- **en-US 回退源已纳入 rebrand**（vela-src browser/locales/en-US + toolkit/locales/en-US），外科手术版 v3 脚本只动值不动键（首版粗放替换曾损坏 zh-CN 含 Firefox 的键名，已 git 还原重跑修复）。
- **"Vela 帮助"入口移除**：preferences.xhtml 的 helpButton（slot=secondary-nav, support-page=preferences）整块删除，overlay 收编。

### 收藏交互改版（2026-09-08，用户 UX 反馈驱动）

- 用户否决"hover 滑出收藏栏"方案（误触发烦人），定案：**收藏入口常驻顶栏右侧（登录按钮旁），悬停 150ms 自动展开下拉**。
- 实现：①撤 auto-hide CSS ②`browser.toolbars.bookmarks.visibility=never`（收藏栏默认不显示）③CustomizableUI.sys.mjs 默认 nav-bar 布局插入 `bookmarks-menu-button`（downloads-button 前）④`vela-bookmarks.js` 悬停展开（`btn.open = true`，BMB 是 type="menu" toolbarbutton 原生支持 open 属性；pref `vela.bookmarks.hoverOpen`）。
- 下拉内容 = 书签菜单（书签工具栏文件夹/最近书签/全部书签），星标收藏页仍在地址栏。
20. **新标签页白屏 = profile 的 about:home 启动缓存坏了**：AboutHomeStartupCache 把首次渲染缓存进 profile/startupCache；dev 换构建后 buildID 不变→陈旧缓存持续命中（曾渲染过半残状态就永远白屏）。修复：删 profile/startupCache（dev-run.sh 已自动化）。全新 profile 不受影响。新标签页搜索框自动使用"搜索设置"里的默认引擎（handoff 机制）。
21. **顶栏按钮布局对老 profile 不生效 = 缺迁移**：CustomizableUI 默认布局（navbarPlacements）只用于全新 profile；已存布局走 currentVersion 迁移。Vela 加了 v25 迁移（kVersion 24→25）：已存 nav-bar 且无 bookmarks-menu-button 时，插到 urlbar 右侧簇首位（登录按钮旁）。验证法：复制 profile 启动后读 prefs.js 的 browser.uiCustomization.state。注意验证截图时 findwin 可能抓到用户正在跑的实例窗口（按标题过滤不够，需按 profile 判断）。
22. **磁贴"点不开"真凶 = 超级拖拽把手抖点击吞掉**：磁贴是链接，点击时鼠标抖动 ≥1px 就触发 dragstart，dropEffect=none 判定为拖到空白 → 静默开后台标签（前台无反应）。修复：frame script 记录起点，位移 <8px 不触发超级拖拽。另：启航页磁贴点击改为**新标签打开**（frame script 捕获 .top-site-outer 点击 preventDefault + 转发 chrome 开前台标签；数据源确认 frame script 在 about:home/newtab 正常注入）。dev-run 的 startupCache 清空改回 pref 方案（browser.startup.homepage.abouthome_cache.enabled=false）——清空 startupCache 会让每次启动全量重编译，是"卡顿"感来源之一。
23. **启航页玻璃态**：activity-stream.css 尾部 Vela 区块——搜索框/磁贴 backdrop-filter 磨砂+半透明白+细描边+深投影，壁纸之上效果最佳（纯色底偏含蓄）。壁纸由 RemoteSettings 集合 newtab-wallpapers-v2 供给（网络依赖），pref: newtabWallpapers.enabled/.wallpaper。
- **GitHub OAuth App 已注册**：client_id `Ov23liI2QERC3AZu8mdn`（Device Flow，无 secret；Redirect URI 填了仓库地址但设备流不用；token 不过期）。设备流申请接口已 curl 实测通（返回 user_code/verification_uri/device_code）。client_id 以出厂 pref `vela.github.clientId` 固化。
24. **M5a GitHub 同步（进行中）**：引擎完成（VelaGitHub.syncNow：自动建私有仓库 vela-sync → 收藏树序列化 → URL 并集合并 → Contents API SHA 乐观锁推送；PlacesUtils 观察者 5s 防抖；启动自动同步）。设置页卡片已注册（account-sync.mjs githubSync 组 + main.js addSetting 处理器 + zh-CN/en-US 文案入包）——**渲染门槛未破**：卡片在"账户与同步"面板只渲染组标题不渲染条目（探针实证 items=2、setting 解析成功、visible=true，但控件未绘制；同构 promo 卡片在"主页"面板正常）。下一步：远程调试器（devtools protocol）实时 DOM 调试。**过渡可用**：浏览器控制台执行 `VelaGitHub.beginLogin()`（输授权码登录）→ `VelaGitHub.syncNow()`（自动建仓+同步）。
25. **浏览器控制台触发 VelaGitHub 的正确姿势**：Browser Console 不在 browser.xhtml 作用域，直接敲 `VelaGitHub` 会 ReferenceError。正确命令：
`Services.wm.getMostRecentWindow("navigator:browser").VelaGitHub.beginLogin()`（登录：弹授权码+开授权页+轮询）
`Services.wm.getMostRecentWindow("navigator:browser").VelaGitHub.syncNow()`（同步：自动建仓+推送）
API 段已用 gh 凭据全链路实测（建仓/404/PUT/回读+SHA 全部 ✓，仓库 vpertj/vela-sync 已建）。
26. **frame script 两大坑（手势/拖拽/磁贴失效真凶）**：①`loadFrameScript` 传 **data: URL 会被 esr153 拒绝**（InternalError: unsafe filename，且部分进程又能执行，症状分裂）；②frame script 沙箱**没有 window/location 全局**（用 content / content.location）。修复：内嵌 data: 脚本改为真实 chrome 文件 `vela-framescript.js`（jar.mn 注册），location → content.location。此修复同时解决：手势失效、拖拽失效、磁贴点击不拦截。诊断入口：mach run stderr 里 grep "unsafe filename"。
27. **顶栏自建按钮"看不见"= 没有图标 CSS**：toolbarbutton 挂进 nav-bar 后是纯图标模式（label 不显示），没有 `list-style-image` 就渲染成透明空白（占位但肉眼不可见，像没放一样）。vela-login-button 曾因此"消失"（代码/布局/迁移全对，就是没图标）。修复：GitHub mark SVG 入 `branding/vela/content/`（jar.mn 注册，`chrome://branding/content/github-mark.svg`）+ osx browser.css 设 `list-style-image` 与 `-moz-context-properties: fill`（context-fill 跟随工具栏前景色）。同批加固 v26 迁移：存档里既无 fxa 按钮也无 vela-login-button 的老 profile，在 downloads-button 后补插。**另注意 dev-run.sh 不构建**——改完 chrome 代码必须先 `./mach build`（增量 ~20s）再 dev-run，否则跑的是旧 dist。
