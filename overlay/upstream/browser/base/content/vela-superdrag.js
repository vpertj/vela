/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Vela 超级拖拽（v1）—— 360 系习惯：
 *   拖链接 → 松手在空白处：后台标签打开（拖到收藏栏/地址栏仍是原生拖放）
 *   拖选中文本 → 默认搜索引擎，新前台标签搜索
 * 实现：frame script 记录 dragstart 来源（链接/选区），dragend 且
 * dropEffect === "none"（没落到任何可放置目标）时触发动作。
 */

var VelaSuperDrag = {
  ENABLED_PREF: "vela.superdrag.enabled",

  init() {
    if (!Services.prefs.getBoolPref(this.ENABLED_PREF, true)) {
      return;
    }
    const mm = window.messageManager;
    mm.loadFrameScript(this.FRAME_SCRIPT, true);
    mm.addMessageListener("Vela:SuperDrag", this);
  },

  FRAME_SCRIPT: "chrome://browser/content/vela-framescript.js",


  receiveMessage(msg) {
    const { kind, value } = msg.data;
    const browser = msg.target;
    if (!value) return;
    if (kind === "link") {
      openLinkIn(value, "tab", {
        inBackground: !msg.data.foreground,
        relatedToCurrent: true,
        triggeringPrincipal: browser.contentPrincipal,
      });
    } else if (kind === "text") {
      (async () => {
        const engine = await Services.search.getDefault();
        const sub = engine.getSubmission(value);
        if (!sub) return;
        openTrustedLinkIn(sub.uri.spec, "tab", {
          postData: sub.postData,
          relatedToCurrent: true,
        });
      })();
    }
  },
};

window.addEventListener(
  "load",
  () => Services.tm.dispatchToMainThread(() => VelaSuperDrag.init()),
  { once: true }
);
