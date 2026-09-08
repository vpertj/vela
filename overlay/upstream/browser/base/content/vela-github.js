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
    const logins = await Services.logins.findLogins(
      this.LOGIN_MANAGER_ORIGIN,
      null,
      ""
    );
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
    const logins = await Services.logins.findLogins(
      this.LOGIN_MANAGER_ORIGIN,
      null,
      ""
    );
    if (logins.length) {
      this._token = logins[0].password;
    }
    return this._token;
  },

  async logout() {
    this.cancelLogin();
    this._token = null;
    this._profile = null;
    const logins = await Services.logins.findLogins(
      this.LOGIN_MANAGER_ORIGIN,
      null,
      ""
    );
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

  /** 启动时恢复登录态 */
  async init() {
    try {
      await this._loadToken();
      if (this._token) {
        await this.refreshProfile();
        Services.obs.notifyObservers(null, "vela-github:login");
      }
    } catch (ex) {
      Cu.reportError("VelaGitHub init: " + ex);
    }
  },
};

window.addEventListener(
  "load",
  () => Services.tm.dispatchToMainThread(() => VelaGitHub.init()),
  { once: true }
);
