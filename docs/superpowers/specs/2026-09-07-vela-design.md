# Vela 浏览器 — 设计文档

- 日期：2026-09-07
- 状态：待用户审阅
- 阶段：概念设计（brainstorming 产出）

## 1. 项目定位

**Vela** 是一款三端（macOS / Windows / Android）浏览器。核心理念：

> 引擎借力，外壳革新。帆不自己造风——把风变成自己的速度。

要抛弃的不是工程上的成熟引擎，而是"老的浏览器模式"（标签栏 + 地址栏 + 书签的传统外壳）。Vela 的创新空间全部在 Shell 层（交互模式、隐私过滤、轻量化体验），引擎层借力 Gecko。

产品四目标：

| 目标 | 由谁保证 |
|---|---|
| 快 | 引擎现成性能（Stylo/WebRender）+ 默认屏蔽跟踪器不拖后腿 |
| 安全 | 每空间会话隔离 + 引擎安全补丁由 Mozilla 官方供给 |
| 不拖泥带水 | 默认无新闻页 / 无账号强绑定 / 无预加载，功能按需加载 |
| 好扩展 | 兼容 Chrome 扩展格式（WebExtensions）+ 控制面核心一份 Rust 好维护 |

## 2. 命名

**Vela**（维拉）。拉丁语"帆"；南天船帆座（南船座 Argo 拆分后的扬帆部分）。

- 词源契合：navigate 源自拉丁语 navis（船），浏览器本质是航行工具。
- 架构隐喻：帆借风前行 = 引擎借力 Gecko，自有力气花在船身（Shell）。
- 与作者既有项目 Lumen 同一审美族谱（拉丁天文词）。

开放事项：域名（velabrowser.org 等）与商标尽调未做，注册前必须完成。

## 3. 已否决的技术路线（决策记录）

| 路线 | 否决原因 |
|---|---|
| 自研引擎 | 3500 万行级 + 30 年 web 兼容壁垒（Ladybird 全职团队 7 年才到 2026 alpha，且仅 Linux/macOS） |
| Electron + WebContentsView 原型 | **overlay 死锁**：WebContentsView 是原生合成层，HTML 永远无法盖在其上（electron#42061 无 z-order API、#49039 无点击穿透），而新模式交互（命令面板/标签预览/侧栏）全是 overlay；且 Electron 的 Chromium 版本与安全补丁滞后主线 |
| Tauri v2 multiwebview | 多 webview 仍实验性（Linux WebKitGTK 有布局坑）、系统 WebView 双引擎不一致、请求拦截等控制面弱 |
| Wails / 系统 WebView 嵌入 | 单 webview 应用模型，多标签保留状态做不了；控制面（拦截/注入/隔离）缺失 |
| Chromium fork | Android 端要啃整个 Chrome Android 应用（百万行 Java/Kotlin），rebase 需专职团队；且桌面 UI 层是 C++ Views，改外壳要动 C++ |
| Swift + WKWebView（macOS-first） | macOS-only，三端下 Windows/Android 无法复用（Orion 路线，已出局） |
| Servo / Ladybird 嵌入 | 非成熟技术栈：Servo 转 Igalia 维护的嵌入式方向；Ladybird 2026 年才 alpha |

## 4. 选定架构：Gecko 全线 + Rust 核心 + UI 两套

```
┌ UI 层 ──────── 桌面：HTML/CSS/JS（改造 browser.xhtml，overlay/DOM 完全自由）
│                Android：Kotlin + Jetpack Compose（嵌 GeckoView）
├ 控制面核心 ─── Rust 一份，三端共享：过滤/隐私规则引擎、空间与书签数据模型、
│                同步协议（桌面经 Rust 组件进 Gecko，Android 经 UniFFI 绑 Kotlin）
├ 引擎层 ─────── 桌面 Firefox ESR fork ｜ Android GeckoView（同一引擎两条官方供给线）
└ 数据层 ─────── SQLite（三端同 schema），同步后置
```

关键架构事实（选型依据）：

1. **Firefox 桌面的浏览器 UI 本身就是 HTML/CSS/JS（browser.xhtml）**，UI 与网页内容同渲染树——overlay 天然自由，改"浏览器模式" = 改前端，无 Electron 的原生层死锁。Zen Browser 已验证 1-2 人 + 社区可在此层做出全新 UI（未动引擎代码）。
2. **GeckoView 是 Android 上唯一提供官方嵌入 API 的一线引擎**（Firefox for Android 自用）。Android 端因此是"正常 app 开发"（Compose UI + GeckoView 组件），而非 Brave 式啃整个 Chromium Android。
3. **Firefox ESR 一年一个大版本**，rebase 成本对小团队友好；安全补丁由 Mozilla 供给。
4. 引擎内本有大量 Rust（Stylo/WebRender），控制面核心用 Rust 生态顺。

坦白的现实约束：

- UI 必然两套代码（桌面 HTML + Android Compose），与 Chrome/Firefox 自身的做法一致；共享的是设计系统 + Rust 控制面。
- 个别网站兼容性可能略逊 Chromium（Gecko 市场份额小），上线前需用真实使用验证。

## 5. 阶段路线（分解）

浏览器是多子系统项目，按子项目推进，每个子项目独立走 spec → plan → 实现：

1. **M1 桌面底座**（当前）：Firefox ESR 源码获取 + 构建管线（macOS 先行）+ Vela 品牌（改名/图标/签名）+ 跑通一次完整构建与增量构建。
2. **M2 新模式交互假设**（待 brainstorming 细化）：在 browser.xhtml 前端层实现 1-2 个交互假设（候选方向：空间/工作流式标签、命令面板、AI 侧栏——**尚未定案，是 M2 的独立设计课题**）。验收线：作者本人日用 30 分钟不觉得难受。
3. **M3 Rust 控制面核心下沉**：过滤规则、空间数据模型（SQLite schema 三端统一）。
4. **M4 Android 端**：GeckoView + Compose 复刻已验证交互（此时 UI 规范已定型，Android 是实现而非探索）。
5. **M5 同步与跨端**：后置，先单机可用。

## 6. M1 桌面底座（第一个子项目）范围

目标：在 macOS 上从源码构建出可运行的 Vela 桌面浏览器（白牌 Firefox 状态，无交互改动）。

包含：

- mozilla-unified 源码获取（git，按 ESR 分支）与 bootstrap（mach bootstrap）
- 品牌层改造：应用名 Vela、bundle id、图标占位
- 构建验证：mach build 全量 + 增量各一次，能启动进入浏览器主界面
- 构建脚本与文档入库（构建环境、耗时、磁盘占用记录）

不包含（明确出界）：任何 UI/交互改动、Windows 构建、Android、Rust 控制面、同步。

开放问题（M1 执行时回答）：

- 磁盘与时间预算：源码 + 对象文件约 20-40GB，M 系列首次全量构建约 1-2 小时，需实测记录
- mozilla-unified 用 git 镜像还是 hg（倾向 git：mozilla-unified 官方 git 镜像，与作者工具链一致）
- 品牌改造用官方 brand 脚本还是手工 mozconfig/branding 目录

## 7. 风险

| 风险 | 缓解 |
|---|---|
| Firefox 构建链复杂（bootstrap 依赖多） | M1 单独成里程碑，先跑通再谈其他 |
| ESR rebase 仍需年度投入 | 接受；Zen/Floorp 证明社区可维持 |
| 新模式假设验证失败 | M2 是独立课题，失败不影响底座价值；假设可迭代 |
| 名字/商标冲突 | 注册前尽调，备选名：Iris、Peregrine、Zephyr |
