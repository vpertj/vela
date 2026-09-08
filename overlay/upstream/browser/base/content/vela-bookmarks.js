/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Vela 收藏交互：顶栏"收藏"按钮（书签菜单按钮）悬停 150ms 自动展开下拉，
 * 无需点击。点击行为保持原生。pref: vela.bookmarks.hoverOpen
 */

var VelaBookmarks = {
  HOVER_PREF: "vela.bookmarks.hoverOpen",
  DELAY_MS: 150,

  init() {
    if (!Services.prefs.getBoolPref(this.HOVER_PREF, true)) {
      return;
    }
    const btn = document.getElementById("bookmarks-menu-button");
    if (!btn) {
      return;
    }
    let timer = 0;
    btn.addEventListener("mouseenter", () => {
      if (timer) {
        return;
      }
      timer = window.setTimeout(() => {
        timer = 0;
        if (!btn.open) {
          btn.open = true;
        }
      }, this.DELAY_MS);
    });
    const cancel = () => {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
    };
    btn.addEventListener("mouseleave", cancel);
    btn.addEventListener("click", cancel);
    btn.addEventListener("popupshown", cancel);
  },
};

window.addEventListener(
  "load",
  () => Services.tm.dispatchToMainThread(() => VelaBookmarks.init()),
  { once: true }
);
