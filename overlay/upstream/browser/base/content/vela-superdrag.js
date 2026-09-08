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
    mm.loadFrameScript(this._frameScriptSrc, true);
    mm.addMessageListener("Vela:SuperDrag", this);
  },

  get _frameScriptSrc() {
    return `data:application/javascript,${encodeURIComponent(`
      (function() {
        let dragged = null, startX = 0, startY = 0, moved = false;
        const MIN_DRAG = 8; // px：低于此距离视为手抖点击，不触发超级拖拽
        addEventListener("dragstart", e => {
          dragged = null; moved = false;
          startX = e.screenX; startY = e.screenY;
          try {
            const dt = e.dataTransfer;
            const a = e.target.closest && e.target.closest("a[href]");
            if (a && a.href) {
              dragged = { kind: "link", value: a.href };
            } else if (dt.types.includes("text/plain")) {
              const sel = content.getSelection().toString().trim();
              if (sel) dragged = { kind: "text", value: sel.slice(0, 512) };
            }
          } catch (ex) { dragged = null; }
        }, true);
        addEventListener("dragover", e => {
          if (!dragged) return;
          const dx = e.screenX - startX, dy = e.screenY - startY;
          if (dx * dx + dy * dy >= MIN_DRAG * MIN_DRAG) moved = true;
        }, true);
        addEventListener("dragend", e => {
          if (!dragged) return;
          try {
            const dx = e.screenX - startX, dy = e.screenY - startY;
            const far = moved || dx * dx + dy * dy >= MIN_DRAG * MIN_DRAG;
            if (far && e.dataTransfer.dropEffect === "none") {
              sendAsyncMessage("Vela:SuperDrag", dragged);
            }
          } catch (ex) {}
          dragged = null;
        }, true);
        // Vela：启航页磁贴点击 → 新标签打开（360 习惯；拖到别处仍是原生拖放）
        if (/^about:(home|newtab)/.test(location.href)) {
          addEventListener("click", e => {
            if (e.button != 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            const t = e.target.closest && e.target.closest(".top-site-outer");
            if (!t) return;
            const a = t.matches("a[href]") ? t : t.querySelector("a[href]");
            const href = a && a.href;
            if (!href || !/^https?:/.test(href)) return;
            e.preventDefault(); e.stopPropagation();
            sendAsyncMessage("Vela:SuperDrag", { kind: "link", value: href, foreground: true });
          }, true);
        }
      })();
    `)}`;
  },

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
