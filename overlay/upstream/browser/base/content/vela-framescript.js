/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Vela frame script（内容进程侧，chrome:// 真实文件，随浏览器全局注入）
 * - 鼠标手势捕获（右键划动）
 * - 超级拖拽捕获（拖链接/拖选中文本，8px 防手抖）
 * - 启航页磁贴点击 → 新标签
 * 注意：frame script 沙箱没有 window/location 全局，用 content / content.location。
 */

(function () {
  const isStartPage = () => {
    try {
      return /^about:(home|newtab)/.test(content.location.href);
    } catch (ex) {
      return false;
    }
  };

  /* ---------- 鼠标手势 ---------- */
  let gStart = null,
    gPath = [],
    gDirs = "",
    gLastDir = "",
    gArmed = false;
  const G_TH = 14;

  addEventListener("mousedown", e => {
    if (e.button != 2) return;
    gStart = { x: e.screenX, y: e.screenY };
    gPath = [{ x: e.clientX, y: e.clientY }];
    gDirs = "";
    gLastDir = "";
    gArmed = false;
  }, true);

  addEventListener("mousemove", e => {
    if (!gStart) return;
    const dx = e.screenX - gStart.x,
      dy = e.screenY - gStart.y;
    const d =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : dy > 0 ? "D" : "U";
    if (
      (d == "R" && dx > G_TH) ||
      (d == "L" && dx < -G_TH) ||
      (d == "D" && dy > G_TH) ||
      (d == "U" && dy < -G_TH)
    ) {
      if (d != gLastDir) {
        gDirs += d;
        gLastDir = d;
      }
      gStart.x = e.screenX;
      gStart.y = e.screenY;
      gArmed = gArmed || gDirs.length >= 1;
    }
    gPath.push({ x: e.clientX, y: e.clientY });
    if (gArmed) sendAsyncMessage("Vela:GestureMove", { path: gPath });
  }, true);

  addEventListener("mouseup", e => {
    if (e.button != 2 || !gStart) return;
    if (gArmed) sendAsyncMessage("Vela:GestureEnd", { dirs: gDirs, path: gPath });
    gStart = null;
    gArmed = false;
  }, true);

  addEventListener("contextmenu", e => {
    if (gArmed) {
      e.preventDefault();
      e.stopPropagation();
      gArmed = false;
    }
  }, true);

  /* ---------- 超级拖拽 ---------- */
  let dragged = null,
    sX = 0,
    sY = 0,
    moved = false;
  const MIN_DRAG = 8;

  addEventListener("dragstart", e => {
    dragged = null;
    moved = false;
    sX = e.screenX;
    sY = e.screenY;
    try {
      const dt = e.dataTransfer;
      const a = e.target.closest && e.target.closest("a[href]");
      if (a && a.href) {
        dragged = { kind: "link", value: a.href };
      } else if (dt.types.includes("text/plain")) {
        const sel = content.getSelection().toString().trim();
        if (sel) dragged = { kind: "text", value: sel.slice(0, 512) };
      }
    } catch (ex) {
      dragged = null;
    }
  }, true);

  addEventListener("dragover", e => {
    if (!dragged) return;
    const dx = e.screenX - sX,
      dy = e.screenY - sY;
    if (dx * dx + dy * dy >= MIN_DRAG * MIN_DRAG) moved = true;
  }, true);

  addEventListener("dragend", e => {
    if (!dragged) return;
    try {
      const dx = e.screenX - sX,
        dy = e.screenY - sY;
      const far = moved || dx * dx + dy * dy >= MIN_DRAG * MIN_DRAG;
      if (far && e.dataTransfer.dropEffect === "none") {
        sendAsyncMessage("Vela:SuperDrag", dragged);
      }
    } catch (ex) {}
    dragged = null;
  }, true);

  /* ---------- 启航页磁贴：点击 → 新标签 ---------- */
  addEventListener("click", e => {
    if (!isStartPage()) return;
    if (e.button != 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    const t = e.target.closest && e.target.closest(".top-site-outer");
    if (!t) return;
    const a = t.matches("a[href]") ? t : t.querySelector("a[href]");
    const href = a && a.href;
    if (!href || !/^https?:/.test(href)) return;
    e.preventDefault();
    e.stopPropagation();
    sendAsyncMessage("Vela:SuperDrag", {
      kind: "link",
      value: href,
      foreground: true,
    });
  }, true);
})();
