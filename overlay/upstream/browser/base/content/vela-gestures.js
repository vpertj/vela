/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Vela 鼠标手势（v1）—— 右键按住划动，360 系习惯：
 *   ←  后退        →  前进        ↓  关闭标签
 *   ↑↓ 刷新        ↓→ 恢复关闭的标签
 * 实现：内容进程 frame script 捕获鼠标（多进程下内容事件不冒泡到 chrome），
 * chrome 侧画轨迹并执行命令。轨迹 = 靛青 polyline，600ms 后淡出。
 */

var VelaGestures = {
  THRESHOLD: 14, // 单方向判定最小位移 px
  ENABLED_PREF: "vela.gestures.enabled",

  _svg: null,
  _polyline: null,
  _hint: null,
  _hintTimer: null,

  init() {
    if (!Services.prefs.getBoolPref(this.ENABLED_PREF, true)) {
      return;
    }
    // window 级 messageManager：注册 frame script 到本窗口全部浏览器（含后续新建）
    const mm = window.messageManager;
    mm.loadFrameScript(this._frameScriptSrc, true);
    mm.addMessageListener("Vela:GestureStart", this);
    mm.addMessageListener("Vela:GestureMove", this);
    mm.addMessageListener("Vela:GestureEnd", this);
  },

  get _frameScriptSrc() {
    return `data:application/javascript,${encodeURIComponent(`
      (function() {
        let start = null, path = [], dirs = "", lastDir = "", armed = false;
        const TH = ${this.THRESHOLD};
        function send(name, data) { sendAsyncMessage(name, data); }
        addEventListener("mousedown", e => {
          if (e.button != 2) return;
          start = { x: e.screenX, y: e.screenY, cx: e.clientX, cy: e.clientY };
          path = [{ x: e.clientX, y: e.clientY }];
          dirs = ""; lastDir = ""; armed = false;
        }, true);
        addEventListener("mousemove", e => {
          if (!start) return;
          let dx = e.screenX - start.x, dy = e.screenY - start.y;
          let d = Math.abs(dx) > Math.abs(dy)
            ? (dx > 0 ? "R" : "L") : (dy > 0 ? "D" : "U");
          if ((d == "R" && dx > TH) || (d == "L" && dx < -TH) ||
              (d == "D" && dy > TH) || (d == "U" && dy < -TH)) {
            if (d != lastDir) { dirs += d; lastDir = d; }
            start.x = e.screenX; start.y = e.screenY;
            armed = armed || dirs.length >= 1;
          }
          path.push({ x: e.clientX, y: e.clientY });
          if (armed) send("Vela:GestureMove", { path });
        }, true);
        addEventListener("mouseup", e => {
          if (e.button != 2 || !start) return;
          if (armed) send("Vela:GestureEnd", { dirs, path });
          start = null; armed = false;
        }, true);
        addEventListener("contextmenu", e => {
          if (armed) { e.preventDefault(); e.stopPropagation(); armed = false; }
        }, true);
      })();
    `)}`;
  },

  receiveMessage(msg) {
    let browser = msg.target;
    switch (msg.name) {
      case "Vela:GestureStart":
        break;
      case "Vela:GestureMove":
        this._drawTrail(browser, msg.data.path);
        break;
      case "Vela:GestureEnd":
        this._drawTrail(browser, msg.data.path);
        this._runAction(msg.data.dirs);
        this._fadeTrail();
        break;
    }
  },

  /** 内容坐标 → 窗口坐标，画靛青轨迹 */
  _drawTrail(browser, path) {
    if (!path || path.length < 2) return;
    if (!this._svg) {
      const SVGNS = "http://www.w3.org/2000/svg";
      this._svg = document.createElementNS(SVGNS, "svg");
      this._svg.setAttribute("style",
        "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;");
      this._polyline = document.createElementNS(SVGNS, "polyline");
      this._polyline.setAttribute("fill", "none");
      this._polyline.setAttribute("stroke", "#3563E9");
      this._polyline.setAttribute("stroke-width", "3");
      this._polyline.setAttribute("stroke-linecap", "round");
      this._polyline.setAttribute("stroke-linejoin", "round");
      this._svg.appendChild(this._polyline);
      document.documentElement.appendChild(this._svg);
    }
    this._svg.style.opacity = "1";
    let rect = browser.getBoundingClientRect();
    this._polyline.setAttribute("points",
      path.map(p => `${p.x + rect.left},${p.y + rect.top}`).join(" "));
  },

  _fadeTrail() {
    if (!this._svg) return;
    this._svg.style.transition = "opacity .5s";
    this._svg.style.opacity = "0";
  },

  _runAction(dirs) {
    switch (dirs) {
      case "L": gBrowser.goBack(); break;
      case "R": gBrowser.goForward(); break;
      case "D": gBrowser.removeCurrentTab(); break;
      case "UD": gBrowser.selectedBrowser.reload(); break;
      case "DR": undoCloseTab(); break;
    }
  },
};

// 由 browser-main.js 的窗口初始化路径调用（延迟到首窗空闲，避免拖慢启动）
window.addEventListener(
  "load",
  () => Services.tm.dispatchToMainThread(() => VelaGestures.init()),
  { once: true }
);
