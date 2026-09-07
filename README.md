# Vela

> 帆不自己造风——把风变成自己的速度。

Vela 是一款三端（macOS / Windows / Android）浏览器。核心理念：**引擎借力，外壳革新**——抛弃的是"老的浏览器模式"（标签栏 + 地址栏 + 书签的传统外壳），不是成熟的引擎。

## 产品目标

| 目标 | 由谁保证 |
|---|---|
| 快 | 引擎现成性能（Stylo/WebRender）+ 默认屏蔽跟踪器不拖后腿 |
| 安全 | 每空间会话隔离 + 引擎安全补丁由 Mozilla 官方供给 |
| 不拖泥带水 | 默认无新闻页 / 无账号强绑定 / 无预加载 |
| 好扩展 | 兼容 Chrome 扩展格式 + 控制面核心一份 Rust |

## 架构

```
┌ UI 层 ──────── 桌面：HTML/CSS/JS（改造 browser.xhtml）
│                Android：Kotlin + Jetpack Compose（嵌 GeckoView）
├ 控制面核心 ─── Rust 一份，三端共享（过滤规则/空间数据模型/同步协议）
├ 引擎层 ─────── 桌面 Firefox ESR fork ｜ Android GeckoView
└ 数据层 ─────── SQLite（三端同 schema）
```

## 路线

M1 桌面底座（构建管线 + 品牌）→ M2 新模式交互假设 → M3 Rust 控制面下沉 → M4 Android → M5 同步。

详见 [设计文档](docs/superpowers/specs/2026-09-07-vela-design.md)。
