/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This file contains branding-specific prefs.

pref("startup.homepage_override_url", "");
pref("startup.homepage_welcome_url", "");
pref("startup.homepage_welcome_url.additional", "");
// The time interval between checks for a new version (in seconds)
pref("app.update.interval", 86400); // 24 hours
// Give the user x seconds to react before showing the big UI. default=24 hours
pref("app.update.promptWaitTime", 86400);
// URL user can browse to manually if for some reason all update installation
// attempts fail.
pref("app.update.url.manual", "https://nightly.mozilla.org");
// A default value for the "More information about this update" link
// supplied in the "An update is available" page of the update wizard.
pref("app.update.url.details", "https://nightly.mozilla.org");

// The number of days a binary is permitted to be old
// without checking for an update.  This assumes that
// app.update.checkInstallTime is true.
pref("app.update.checkInstallTime.days", 2);

// Give the user x seconds to reboot before showing a badge on the hamburger
// button. default=immediately
pref("app.update.badgeWaitTime", 0);

// Number of usages of the web console.
// If this is less than 5, then pasting code into the web console is disabled
pref("devtools.selfxss.count", 5);

// Vela 出厂形态（M2 第一刀）：竖向标签栏，Arc 式侧栏布局
pref("sidebar.revamp", true);
pref("sidebar.verticalTabs", false); // 默认顶部标签（大陆习惯）；左栏竖标签为可切换的专注形态

// Vela 出厂语言：简体中文（en-US 为内置基准，设置页"语言"可随时切换）
pref("intl.locale.requested", "zh-CN");

// Vela 自构建分发：允许未签名 langpack（官方签名通道不适用于自有构建，
// 否则 zh-CN 语言包被拒绝装载导致默认语言回落英文）
pref("extensions.langpacks.signatures.required", false);

// Vela 启航页：无资讯流/无推荐内容，只留搜索框 + 常用九宫格（高频自适应）
pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
pref("browser.newtabpage.activity-stream.feeds.highlights", false);
pref("browser.newtabpage.activity-stream.feeds.snippets", false);
pref("browser.newtabpage.activity-stream.showSearch", true);
pref("browser.newtabpage.activity-stream.feeds.topsites", true);

// Vela 出厂零打扰：不打开 Mozilla 遥测隐私告知页（首启直接进启航页）
pref("datareporting.policy.firstRunURL", "");
pref("browser.rights.3.shown", true);

// Vela 出厂不显示"实验室"分区（内部实验开关不面向用户）
pref("browser.preferences.experimental.hidden", true);
pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);

// Vela 默认磁贴：大陆常用站（首次启动的初始九宫格，之后按使用频次自适应）
pref("browser.newtabpage.activity-stream.default.sites", "https://www.baidu.com/,https://www.zhihu.com/,https://www.bilibili.com/,https://weibo.com/,https://www.taobao.com/");

// 默认磁贴本地化：关闭 Mozilla RemoteSettings 在线磁贴源（既保证大陆默认站生效，
// 也去掉首启对该服务器的网络依赖），改用上方 activity-stream.default.sites 本地清单
pref("browser.topsites.useRemoteSetting", false);

// Vela 超级拖拽（拖链接=后台标签；拖选中文本=默认引擎搜索）
pref("vela.superdrag.enabled", true);

// 鼠标手势出厂关闭（用户反馈轨迹画线干扰正常使用）。想要可在 about:config
// 把 vela.gestures.enabled 改 true
pref("vela.gestures.enabled", false);

// Vela 收藏交互：书签菜单按钮常驻顶栏（悬停展开下拉），收藏栏默认不显示
pref("browser.toolbars.bookmarks.visibility", "never");
pref("vela.bookmarks.hoverOpen", true);

// GitHub OAuth App（Vela）——Device Flow 登录与收藏同步
pref("vela.github.clientId", "Ov23liI2QERC3AZu8mdn");

// FxA 火狐账号体系退役：账号与同步全面切换到 GitHub（官方企业级开关，
// 等同 DisableFirefoxAccounts 策略效果但不触发“组织管理”横幅）
pref("identity.fxaccounts.enabled", false);
