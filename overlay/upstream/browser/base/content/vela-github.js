/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Vela GitHub 账号与同步核心（M5a）
 * - 登录：GitHub OAuth Device Flow（浏览器打开 verification_uri，用户输码，本地轮询 token）
 * - 令牌存储：Firefox Login Manager（系统加密，不明文落盘）
 * - 同步（下一片）：收藏树 JSON → 私有仓库 Contents API（SHA 乐观锁）
 * pref: vela.github.clientId（OAuth App 的 client_id；产品化前用 dev 兜底值）
 */

var VelaGitHub = {
  CLIENT_ID_PREF: "vela.github.clientId",
  // DEV 兜底：复用 GitHub CLI 的公开 client_id（设备流无密钥）；产品化注册 Vela 自己的 OAuth App 后替换
  DEV_CLIENT_ID: "178c6fc778ccc68e1d6a",
  LOGIN_MANAGER_ORIGIN: "chrome://vela-github",
  API: "https://api.github.com",

  _token: null,
  _profile: null,
  _pollAbort: null,

  get clientID() {
    return (
      Services.prefs.getStringPref(this.CLIENT_ID_PREF, "") ||
      this.DEV_CLIENT_ID
    );
  },

  /** 当前登录状态：{ loggedIn, name, avatar } —— UI 轮询/监听用 */
  get status() {
    return {
      loggedIn: !!this._token,
      name: this._profile ? this._profile.login : null,
      avatar: this._profile ? this._profile.avatar_url : null,
    };
  },

  /** 发起设备流登录：打开 github.com/login/device，返回 { userCode, verificationUri } */
  async beginLogin() {
    const res = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: this.clientID,
        scope: "repo read:user",
      }),
      // 大陆网络 github 可能长时间挂起：15s 超时给明确报错，不做无声等待
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error("device code request failed: " + res.status);
    }
    const d = await res.json();
    dump("VELA_GH device code ready: " + d.user_code + "\n");
    // 打开授权页（用本浏览器）
    openTrustedLinkIn(d.verification_uri, "tab");
    this._presentCode(d.user_code);
    this._pollAbort = new AbortController();
    // 后台轮询 token（interval 秒，遇 slow_down 顺延）
    this._pollToken(d).catch(ex => {
      if (ex.name != "AbortError") {
        Cu.reportError("VelaGitHub poll: " + ex);
      }
    });
    return { userCode: d.user_code, verificationUri: d.verification_uri };
  },

  /** 授权码 UI：自动复制剪贴板 + 系统通知 + 页内通知栏（替代阻塞式 alert） */
  _presentCode(code) {
    try {
      Cc["@mozilla.org/widget/clipboardhelper;1"]
        .getService(Ci.nsIClipboardHelper)
        .copyString(code);
    } catch (ex) {}
    try {
      Cc["@mozilla.org/alerts-service;1"]
        .getService(Ci.nsIAlertsService)
        .showAlertNotification(
          "chrome://branding/content/icon128.png",
          "Vela GitHub 登录",
          "授权码 " + code + " 已复制到剪贴板，粘贴到 GitHub 页面即可"
        );
    } catch (ex) {}
    const showBar = () => {
      try {
        const nb = gBrowser.getNotificationBox(this._codeBarBrowser);
        nb.appendNotification(
          "vela-github-code",
          {
            label:
              "GitHub 授权码 " + code + " 已复制到剪贴板——在 GitHub 页面粘贴即可",
            priority: nb.PRIORITY_WARNING_HIGH,
          },
          [
            {
              label: "复制授权码",
              callback: () => {
                Cc["@mozilla.org/widget/clipboardhelper;1"]
                  .getService(Ci.nsIClipboardHelper)
                  .copyString(code);
              },
            },
          ]
        );
      } catch (ex) {
        Cu.reportError("VelaGitHub code bar: " + ex);
      } finally {
        dump("VELA_GH bar shown\n");
      }
    };
    const browser = gBrowser.getBrowserForTab(gBrowser.selectedTab);
    showBar();
    // 页面导航会清空通知栏（device→login 重定向），每次顶层页面加载完成后
    // 重挂，让授权码在登录全程都可见。注意 browser 元素上挂 "load" 收不到
    // 内容页加载事件——必须用 WebProgressListener
    if (this._codeBarBrowser !== browser) {
      if (this._codeBarBrowser && this._codeBarWPL) {
        this._codeBarBrowser.removeProgressListener(this._codeBarWPL);
      }
      this._codeBarWPL = {
        QueryInterface: ChromeUtils.generateQI([
          "nsIWebProgressListener",
          "nsISupportsWeakReference",
        ]),
        onStateChange: (wp, req, flags, status) => {
          if (
            flags & Ci.nsIWebProgressListener.STATE_STOP &&
            flags & Ci.nsIWebProgressListener.STATE_IS_NETWORK
          ) {
            showBar();
          }
        },
      };
      browser.addProgressListener(this._codeBarWPL);
      this._codeBarBrowser = browser;
    }
  },

  cancelLogin() {
    if (this._pollAbort) {
      this._pollAbort.abort();
      this._pollAbort = null;
    }
  },

  async _pollToken(d) {
    let interval = (d.interval || 5) * 1000;
    const deadline = Date.now() + (d.expires_in ? d.expires_in * 1000 : 900000);
    // 轮询必须皮实：网络抖动一次就退出会让用户"授权成功却未登录"
    // （令牌从未入库）。只有用户取消/明确拒绝/超时才结束
    while (Date.now() < deadline) {
      try {
        await new Promise((ok, err) => {
          setTimeout(ok, interval);
          this._pollAbort?.signal.addEventListener(
            "abort",
            () =>
              err(Object.assign(new Error("aborted"), { name: "AbortError" })),
            { once: true }
          );
        });
      } catch (ex) {
        throw ex; // 用户取消登录
      }
      let j = null;
      try {
        const res = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: this.clientID,
            device_code: d.device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
          signal: this._pollAbort?.signal,
        });
        j = await res.json();
      } catch (ex) {
        if (ex && ex.name == "AbortError") {
          throw ex;
        }
        continue; // 网络抖动：不计失败，继续轮询
      }
      if (j.access_token) {
        await this._storeToken(j.access_token);
        await this.refreshProfile();
        try {
          Cc["@mozilla.org/alerts-service;1"]
            .getService(Ci.nsIAlertsService)
            .showAlertNotification(
              "chrome://branding/content/icon128.png",
              "Vela GitHub 登录",
              "已登录：" + (this._profile?.login || "GitHub 账号")
            );
        } catch (ex) {}
        Services.obs.notifyObservers(null, "vela-github:login");
        return;
      }
      if (j.error == "authorization_pending") {
        continue;
      }
      if (j.error == "slow_down") {
        interval += 5000;
        continue;
      }
      throw new Error("device flow error: " + (j.error || "unknown"));
    }
    throw new Error("设备码已过期（15 分钟），请重新登录");
  },

  /** 令牌存取（Login Manager 加密存储） */
  async _storeToken(token) {
    this._token = token;
    const logins = await Services.logins.searchLoginsAsync({
      origin: this.LOGIN_MANAGER_ORIGIN,
    });
    for (const l of logins) {
      await Services.logins.removeLoginAsync(l);
    }
    const info = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(
      Ci.nsILoginInfo
    );
    info.init(this.LOGIN_MANAGER_ORIGIN, null, "", "github", token, "", "");
    await Services.logins.addLoginAsync(info);
  },

  async _loadToken() {
    if (this._token) {
      return this._token;
    }
    const logins = await Services.logins.searchLoginsAsync({
      origin: this.LOGIN_MANAGER_ORIGIN,
    });
    if (logins.length) {
      this._token = logins[0].password;
    }
    return this._token;
  },

  async logout() {
    this.cancelLogin();
    this._token = null;
    this._profile = null;
    const logins = await Services.logins.searchLoginsAsync({
      origin: this.LOGIN_MANAGER_ORIGIN,
    });
    for (const l of logins) {
      await Services.logins.removeLoginAsync(l);
    }
    Services.obs.notifyObservers(null, "vela-github:logout");
  },

  /** 拉取 GitHub 身份信息 */
  async refreshProfile() {
    const token = await this._loadToken();
    if (!token) {
      return null;
    }
    const res = await fetch(this.API + "/user", {
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      throw new Error("profile fetch failed: " + res.status);
    }
    this._profile = await res.json();
    return this._profile;
  },

  /** 启动时恢复登录态；已登录且开启同步则先同步一次 */
  async init() {
    try {
      // 跨窗口登录态同步：任意窗口登录/登出，其他窗口立即跟着刷新
      if (!this._stateObserver) {
        this._stateObserver = (subject, topic) => {
          if (topic == "vela-github:login") {
            this._token = null;
            this._loadToken()
              .then(() => this.refreshProfile())
              .then(() => {
                this._addBookmarkObserver();
                this._startPeriodicSync();
              })
              .catch(ex => Cu.reportError("VelaGitHub login obs: " + ex));
          } else if (topic == "vela-github:logout") {
            this._token = null;
            this._profile = null;
          }
        };
        Services.obs.addObserver(this._stateObserver, "vela-github:login");
        Services.obs.addObserver(this._stateObserver, "vela-github:logout");
      }
      await this._loadToken();
      if (this._token) {
        await this.refreshProfile();
        this._addBookmarkObserver();
        this._startPeriodicSync();
        Services.obs.notifyObservers(null, "vela-github:login");
        if (Services.prefs.getBoolPref(this.SYNC_ENABLED_PREF, true)) {
          await this.syncNow().catch(ex =>
            Cu.reportError("VelaGitHub startup sync: " + ex)
          );
        }
      }
    } catch (ex) {
      Cu.reportError("VelaGitHub init: " + ex);
    }
    if (Services.env.get("VELA_SELFTEST") == "1") {
      setTimeout(() => this._selfTest(), 0);
    }
  },

  /* ==================== 收藏同步引擎（M5a） ==================== */

  SYNC_ENABLED_PREF: "vela.github.sync.enabled",
  SYNC_INTERVAL_PREF: "vela.github.sync.intervalSec",
  REPO_PREF: "vela.github.sync.repo",
  LAST_SYNC_PREF: "vela.github.lastSync",
  REPO_NAME: "vela-sync",

  get repoName() {
    return Services.prefs.getStringPref(this.REPO_PREF, this.REPO_NAME);
  },
  get repoPath() {
    return "bookmarks.json";
  },
  _applying: false,
  _syncTimer: 0,

  /** 收藏变更 → 5s 防抖自动同步 */
  _addBookmarkObserver() {
    if (this._placesListener) {
      return;
    }
    // esr153：老 bookmarks.addObserver 已移除，改 PlacesObservers 事件流
    this._placesListener = events => {
      dump("VELA_GH obs " + events.map(e => e.type).join(",") + "\n");
      this._schedule();
    };
    PlacesObservers.addListener(
      [
        "bookmark-added",
        "bookmark-removed",
        "bookmark-moved",
        "bookmark-title-changed",
        "bookmark-url-changed",
      ],
      this._placesListener
    );
  },

  _schedule() {
    if (this._applying) {
      return; // 同步写入引发的变更不回流
    }
    if (!Services.prefs.getBoolPref(this.SYNC_ENABLED_PREF, true)) {
      return;
    }
    if (this._syncTimer) {
      return;
    }
    this._syncTimer = window.setTimeout(() => {
      this._syncTimer = 0;
      dump("VELA_GH debounced autosync\n");
      this.syncNow().catch(ex => Cu.reportError("VelaGitHub autosync: " + ex));
    }, 5000);
  },

  get _apiHeaders() {
    return {
      Authorization: "Bearer " + this._token,
      Accept: "application/vnd.github+json",
    };
  },

  /** 私有同步仓库不存在则自动创建 */
  async _ensureRepo() {
    const owner = this._profile.login;
    const res = await fetch(
      `${this.API}/repos/${owner}/${this.repoName}`,
      { headers: this._apiHeaders }
    );
    if (res.ok) {
      return;
    }
    if (res.status != 404) {
      throw new Error("repo lookup " + res.status);
    }
    const create = await fetch(this.API + "/user/repos", {
      method: "POST",
      headers: { ...this._apiHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: this.repoName,
        private: true,
        auto_init: true,
        description: "Vela browser bookmarks sync (auto-created)",
      }),
    });
    if (!create.ok && create.status != 422) {
      throw new Error("repo create " + create.status);
    }
  },

  /** 收藏树 → 紧凑 JSON（folders + bookmarks）。
   *  esr153 移除了 fetch() 无参全树接口，改用 promiseBookmarksTree：
   *  节点属性 uri(URL 对象)/typeCode(数值)/children */
  async _serialize() {
    const root = await PlacesUtils.promiseBookmarksTree(
      PlacesUtils.bookmarks.rootGuid
    );
    const walk = n => {
      const o = { t: n.title || "" };
      if (n.uri) {
        o.u = n.uri;
      }
      if (n.dateAdded) {
        o.d = Number(n.dateAdded);
      }
      if (n.children) {
        const kids = (n.children || [])
          .filter(
            k =>
              k.typeCode == PlacesUtils.bookmarks.TYPE_FOLDER ||
              k.typeCode == PlacesUtils.bookmarks.TYPE_BOOKMARK
          )
          .map(walk);
        if (kids.length) {
          o.c = kids;
        }
        o.f = n.typeCode == PlacesUtils.bookmarks.TYPE_FOLDER;
      }
      return o;
    };
    return {
      v: 1,
      at: Date.now(),
      buckets: (root.children || [])
        .filter(c => c.typeCode == PlacesUtils.bookmarks.TYPE_FOLDER)
        .map(walk),
    };
  },

  /** 远端树合并进本地：按 URL 并集（v1 不传播删除） */
  async _applyRemote(remote) {
    if (!remote || !remote.buckets) {
      return;
    }
    const localRoot = await PlacesUtils.promiseBookmarksTree(
      PlacesUtils.bookmarks.rootGuid
    );
    const localUrls = new Set();
    const collect = n => {
      if (n.uri) {
        localUrls.add(n.uri);
      }
      (n.children || []).forEach(collect);
    };
    collect(localRoot);
    this._applying = true;
    try {
      const mergeFolder = async (remoteNode, localNode, parentGuid) => {
        let guid = localNode ? localNode.guid : null;
        if (!guid) {
          guid = (
            await PlacesUtils.bookmarks.insert({
              parentGuid,
              type: PlacesUtils.bookmarks.TYPE_FOLDER,
              title: remoteNode.t || "synced",
            })
          ).guid;
        }
        const localKids = (localNode && localNode.children) || [];
        for (const kid of remoteNode.c || []) {
          if (kid.c) {
            const localKid = localKids.find(k => (k.title || "") === kid.t && k.typeCode == PlacesUtils.bookmarks.TYPE_FOLDER);
            await mergeFolder(kid, localKid, guid);
          } else if (kid.u && !localUrls.has(kid.u)) {
            await PlacesUtils.bookmarks.insert({
              parentGuid: guid,
              type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
              url: kid.u,
              title: kid.t || "",
            });
            localUrls.add(kid.u);
          }
        }
      };
      for (const bucket of remote.buckets) {
        const localBucket = (localRoot.children || []).find(
          c => (c.title || "") === bucket.t
        );
        await mergeFolder(bucket, localBucket, PlacesUtils.bookmarks.rootGuid);
      }
    } finally {
      this._applying = false;
    }
  },

  /** 同步主流程：建仓 → 拉取合并 → 推送（防重入：观察者与周期器并发时跳过） */
  async syncNow() {
    if (this._syncing) {
      dump("VELA_GH sync skip (in-flight)\n");
      return;
    }
    this._syncing = true;
    try {
      await this._syncNowInner();
    } finally {
      this._syncing = false;
    }
  },

  async _syncNowInner() {
    const token = await this._loadToken();
    if (!token) {
      throw new Error("not logged in");
    }
    if (!this._profile) {
      await this.refreshProfile();
    }
    const owner = this._profile.login;
    await this._ensureRepo();
    const fileUrl = `${this.API}/repos/${owner}/${this.repoName}/contents/${this.repoPath}`;
    let sha = null,
      remote = null;
    const head = await fetch(fileUrl, {
      headers: this._apiHeaders,
      cache: "no-store",
    });
    if (head.ok) {
      const j = await head.json();
      sha = j.sha;
      try {
        remote = JSON.parse(
          decodeURIComponent(escape(atob(j.content.replace(/\n/g, ""))))
        );
      } catch (ex) {
        remote = null;
      }
    } else if (head.status != 404) {
      throw new Error("fetch remote " + head.status);
    }
    if (remote) {
      await this._applyRemote(remote);
    }
    const payload = JSON.stringify(await this._serialize(), null, 1);
    const content = btoa(unescape(encodeURIComponent(payload)));
    const put = await fetch(fileUrl, {
      method: "PUT",
      headers: { ...this._apiHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Vela bookmarks sync " + new Date().toISOString(),
        content,
        branch: "main",
        ...(sha ? { sha } : {}),
      }),
    });
    if (!put.ok) {
      const t = await put.text();
      throw new Error("push " + put.status + " " + t.slice(0, 160));
    }
    Services.prefs.setIntPref(this.LAST_SYNC_PREF, Date.now());
    Services.obs.notifyObservers(null, "vela-github:synced");
  },

  /** 周期同步（默认 15 分钟；观察者负责"变化即同步"，这里是兜底） */
  _startPeriodicSync() {
    if (this._periodicTimer) {
      window.clearTimeout(this._periodicTimer);
    }
    const sec = Math.max(
      5,
      Services.prefs.getIntPref(this.SYNC_INTERVAL_PREF, 900)
    );
    this._periodicTimer = window.setTimeout(() => {
      this._periodicTimer = 0;
      if (this.status.loggedIn) {
        this.syncNow().catch(ex =>
          Cu.reportError("VelaGitHub periodic sync: " + ex)
        );
      }
      this._startPeriodicSync();
    }, sec * 1000);
  },

  /** 自动化自测（VELA_SELFTEST=1 触发）：登录态→手动同步→自动同步→周期同步。
   *  用独立测试仓 vela-sync-selftest，不碰用户真实 vela-sync */
  async _selfTest() {
    const t = m => dump("VELA_TEST " + m + "\n");
    try {
      if (typeof gBrowser == "undefined" || !gBrowser) {
        return; // 只在主浏览器窗口跑一次（隐藏窗口/多窗口会重复触发）
      }
      const token = Services.env.get("VELA_TEST_TOKEN");
      if (!token) {
        t("FAIL no VELA_TEST_TOKEN");
        return;
      }
      Services.prefs.setStringPref(this.REPO_PREF, "vela-sync-selftest");
      t("start");
      await this._storeToken(token);
      await this.refreshProfile();
      t("login " + (this.status.loggedIn ? "OK user=" + this.status.name : "FAIL"));
      this._addBookmarkObserver();
      await this.syncNow();
      t("manual-sync OK");
      await PlacesUtils.bookmarks.insert({
        parentGuid: PlacesUtils.bookmarks.menuGuid,
        title: "Vela 自测",
        url: "https://example.com/vela-selftest",
      });
      await new Promise(ok => setTimeout(ok, 12000));
      const owner = this._profile.login;
      const res = await fetch(
        `${this.API}/repos/${owner}/${this.repoName}/contents/${this.repoPath}`,
        { headers: this._apiHeaders, cache: "no-store" }
      );
      const j = await res.json();
      const text = decodeURIComponent(escape(atob(j.content.replace(/\n/g, ""))));
      t(text.includes("vela-selftest") ? "autosync OK" : "autosync FAIL: marker missing");
      Services.prefs.setIntPref(this.SYNC_INTERVAL_PREF, 5);
      this._startPeriodicSync();
      const before = Services.prefs.getIntPref(this.LAST_SYNC_PREF, 0);
      await new Promise(ok => setTimeout(ok, 16000));
      const after = Services.prefs.getIntPref(this.LAST_SYNC_PREF, 0);
      t(after > before ? "interval-sync OK" : "interval-sync FAIL");
      t("PASS");
    } catch (ex) {
      t("FAIL " + ex + " | stack=" + (ex.stack || "").replace(/\n/g, " <- ").slice(0, 400));
    }
  },

  /** 顶栏登录按钮菜单动作 */
  toolbarAction(kind, event) {
    dump("VELA_GH action=" + kind + "\n");
    event?.stopPropagation();
    (async () => {
      if (kind == "login") {
        if (this.status.loggedIn) {
          window.alert("已登录：" + this.status.name);
          return;
        }
        // 授权码 UI（剪贴板+通知栏）由 beginLogin 内部呈现
        await this.beginLogin();
      } else if (kind == "sync") {
        if (!this.status.loggedIn) {
          window.alert("请先登录 GitHub 账号");
          return;
        }
        await this.syncNow();
        window.alert("收藏同步完成 ✓");
      } else if (kind == "logout") {
        await this.logout();
        window.alert("已退出 GitHub 登录");
      }
    })().catch(ex => window.alert("操作失败：" + ex.message));
  },
  /** 下拉菜单项编程式绑定（内联 oncommand 在 CUI 迁移节点上不可靠） */
  bindToolbarMenu() {
    const bindings = [
      ["vela-menu-login", "login"],
      ["vela-menu-sync", "sync"],
      ["vela-menu-logout", "logout"],
    ];
    let bound = 0;
    for (const [id, kind] of bindings) {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("command", e => this.toolbarAction(kind, e));
        bound++;
      }
    }
    dump("VELA_GH menu bound " + bound + "/3\n");
  },
};

dump("VELA_GH loaded\n");
// global-scripts.js 在 browser.xhtml 头部执行，toolbox 标记（含菜单项）尚未
// 解析——绑定与初始化都延到 load（菜单项此刻才存在）
const velaBoot = () => {
  VelaGitHub.bindToolbarMenu();
  Services.tm.dispatchToMainThread(() => VelaGitHub.init());
};
if (document.readyState == "complete") {
  velaBoot();
} else {
  window.addEventListener("load", velaBoot, { once: true });
}
