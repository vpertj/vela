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
    });
    if (!res.ok) {
      throw new Error("device code request failed: " + res.status);
    }
    const d = await res.json();
    dump("VELA_GH device code ready: " + d.user_code + "\n");
    // 打开授权页（用本浏览器）
    openTrustedLinkIn(d.verification_uri, "tab");
    this._pollAbort = new AbortController();
    // 后台轮询 token（interval 秒，遇 slow_down 顺延）
    this._pollToken(d).catch(ex => {
      if (ex.name != "AbortError") {
        Cu.reportError("VelaGitHub poll: " + ex);
      }
    });
    return { userCode: d.user_code, verificationUri: d.verification_uri };
  },

  cancelLogin() {
    if (this._pollAbort) {
      this._pollAbort.abort();
      this._pollAbort = null;
    }
  },

  async _pollToken(d) {
    let interval = (d.interval || 5) * 1000;
    while (true) {
      await new Promise((ok, err) => {
        Services.tm.setTimeout(ok, interval);
        this._pollAbort?.signal.addEventListener("abort", () =>
          err(Object.assign(new Error("aborted"), { name: "AbortError" }))
        );
      });
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
      const j = await res.json();
      if (j.access_token) {
        await this._storeToken(j.access_token);
        await this.refreshProfile();
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
  },

  /** 令牌存取（Login Manager 加密存储） */
  async _storeToken(token) {
    this._token = token;
    const logins = await Services.logins.searchLoginsAsync({
      origin: this.LOGIN_MANAGER_ORIGIN,
    });
    for (const l of logins) {
      Services.logins.removeLogin(l);
    }
    const info = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(
      Ci.nsILoginInfo
    );
    info.init(this.LOGIN_MANAGER_ORIGIN, null, "", "github", token, "", "");
    Services.logins.addLogin(info);
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
      Services.logins.removeLogin(l);
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
      await this._loadToken();
      if (this._token) {
        await this.refreshProfile();
        Services.obs.notifyObservers(null, "vela-github:login");
        if (Services.prefs.getBoolPref(this.SYNC_ENABLED_PREF, true)) {
          await this.syncNow().catch(ex =>
            Cu.reportError("VelaGitHub startup sync: " + ex)
          );
        }
        this._addBookmarkObserver();
      }
    } catch (ex) {
      Cu.reportError("VelaGitHub init: " + ex);
    }
  },

  /* ==================== 收藏同步引擎（M5a） ==================== */

  SYNC_ENABLED_PREF: "vela.github.sync.enabled",
  LAST_SYNC_PREF: "vela.github.lastSync",
  REPO_NAME: "vela-sync",
  REPO_PATH: "vela-sync/bookmarks.json",
  _applying: false,
  _syncTimer: 0,

  /** 收藏变更 → 5s 防抖自动同步 */
  _addBookmarkObserver() {
    if (this._bookmarkObserver) {
      return;
    }
    this._bookmarkObserver = {
      onItemAdded: () => this._schedule(),
      onItemRemoved: () => this._schedule(),
      onItemChanged: () => this._schedule(),
      onItemMoved: () => this._schedule(),
      onBeginUpdateBatch: () => {},
      onEndUpdateBatch: () => {},
    };
    PlacesUtils.bookmarks.addObserver(this._bookmarkObserver);
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
      `${this.API}/repos/${owner}/${this.REPO_NAME}`,
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
        name: this.REPO_NAME,
        private: true,
        auto_init: true,
        description: "Vela browser bookmarks sync (auto-created)",
      }),
    });
    if (!create.ok && create.status != 422) {
      throw new Error("repo create " + create.status);
    }
  },

  /** 收藏树 → 紧凑 JSON（folders + bookmarks） */
  async _serialize() {
    const root = await PlacesUtils.bookmarks.fetch();
    const walk = n => {
      const o = { t: n.title || "" };
      if (n.url) {
        o.u = n.url.spec;
      }
      if (n.dateAdded) {
        o.d = Number(n.dateAdded);
      }
      if (n.children) {
        const kids = n.children
          .filter(
            k =>
              k.type == PlacesUtils.bookmarks.TYPE_FOLDER ||
              k.type == PlacesUtils.bookmarks.TYPE_BOOKMARK
          )
          .map(walk);
        if (kids.length) {
          o.c = kids;
        }
        o.f = n.type == PlacesUtils.bookmarks.TYPE_FOLDER;
      }
      return o;
    };
    return {
      v: 1,
      at: Date.now(),
      buckets: (root.children || [])
        .filter(c => c.type == PlacesUtils.bookmarks.TYPE_FOLDER)
        .map(walk),
    };
  },

  /** 远端树合并进本地：按 URL 并集（v1 不传播删除） */
  async _applyRemote(remote) {
    if (!remote || !remote.buckets) {
      return;
    }
    const localRoot = await PlacesUtils.bookmarks.fetch();
    const localUrls = new Set();
    const collect = n => {
      if (n.url) {
        localUrls.add(n.url.spec);
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
            const localKid = localKids.find(k => (k.title || "") === kid.t && k.type == PlacesUtils.bookmarks.TYPE_FOLDER);
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

  /** 同步主流程：建仓 → 拉取合并 → 推送 */
  async syncNow() {
    const token = await this._loadToken();
    if (!token) {
      throw new Error("not logged in");
    }
    if (!this._profile) {
      await this.refreshProfile();
    }
    const owner = this._profile.login;
    await this._ensureRepo();
    const fileUrl = `${this.API}/repos/${owner}/${this.REPO_NAME}/contents/${this.REPO_PATH}`;
    let sha = null,
      remote = null;
    const head = await fetch(fileUrl, { headers: this._apiHeaders });
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
        const { userCode } = await this.beginLogin();
        window.alert("请在已打开的 GitHub 页面输入授权码：\n" + userCode);
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
    for (const [id, kind] of bindings) {
      document
        .getElementById(id)
        ?.addEventListener("command", e => this.toolbarAction(kind, e));
    }
  },
};

dump("VELA_GH loaded\n");
VelaGitHub.bindToolbarMenu();
if (document.readyState == "complete") {
  Services.tm.dispatchToMainThread(() => VelaGitHub.init());
} else {
  window.addEventListener(
    "load",
    () => Services.tm.dispatchToMainThread(() => VelaGitHub.init()),
    { once: true }
  );
}
