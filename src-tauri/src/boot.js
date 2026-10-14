/* global window, document, MutationObserver */
// Runs in every app webview before the page's own scripts (settings.rs's
// boot_script appends the call with the snapshot). Two jobs:
//
// 1. Publish the snapshot as `window.__BOOT__`, which the frontend reads
//    synchronously (src/storage/boot.ts) instead of localStorage.
// 2. Put the appearance settings on the document NOW, so the first frame is
//    already in the right theme. React applies the same things again once
//    it mounts (SettingsContext.tsx) - the element ids and attributes here
//    must stay the ones it uses, so it takes these over instead of adding
//    second copies.
//
// Plain JavaScript with no imports: it is injected as a string.
window.__levisBoot = function (boot, themeCss) {
  delete window.__levisBoot;
  window.__BOOT__ = boot;
  var settings = boot.settings || {};

  function apply(root) {
    // Same mapping as htmlLang() in SettingsContext.tsx.
    var lang = { en: "en", zh: "zh-CN", ja: "ja" }[settings.language];
    if (lang) root.setAttribute("lang", lang);
    if (settings.theme === "light" || settings.theme === "dark")
      root.setAttribute("data-theme", settings.theme);
    if (
      settings.contentWidth === "standard" ||
      settings.contentWidth === "full"
    )
      root.setAttribute("data-content-width", settings.contentWidth);
    // BUILTIN_CONTENT_THEMES in SettingsContext.tsx, minus "default" (which
    // is the absence of the attribute).
    var builtin = ["paper", "slate", "forest", "parchment"];
    if (builtin.indexOf(settings.themeId) >= 0)
      root.setAttribute("data-content-theme", settings.themeId);
    else if (themeCss) root.setAttribute("data-user-theme", "");
  }

  function addStyle(id, css) {
    var style = document.createElement("style");
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Stylesheets go at the END of <head>, after the app's own CSS, where
  // React keeps them too: custom CSS has to win ties with the theme, and
  // both with App.css. So they wait for <body> to start, which means <head>
  // (and its stylesheet links) has been parsed - and nothing is painted
  // before there's a body to paint.
  function addStyles() {
    if (themeCss) {
      var dark =
        themeCss.dark &&
        (settings.theme === "dark" ||
          (settings.theme !== "light" &&
            window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: dark)").matches));
      // adaptTyporaCss() in src/settings/typora-compat.ts.
      var css = (dark ? themeCss.dark : themeCss.light).replace(
        /\bthead\b(?:\s*>?\s*tr\b)?/g,
        "tr[data-is-header]",
      );
      addStyle("levis-custom-theme", css);
    }
    if (settings.customCss && String(settings.customCss).trim())
      addStyle("levis-user-css", String(settings.customCss));
  }

  try {
    // The document element can still be missing this early on some engines;
    // then the observer below applies the attributes as soon as it exists.
    var root = document.documentElement;
    if (root) apply(root);
    var styles =
      !!themeCss || !!(settings.customCss && String(settings.customCss).trim());
    if (root && !styles) return;
    if (styles && document.body) return addStyles();
    var observer = new MutationObserver(function () {
      if (!root && document.documentElement) {
        root = document.documentElement;
        apply(root);
      }
      if (root && (!styles || document.body)) {
        observer.disconnect();
        if (styles) addStyles();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  } catch {
    // A first-paint nicety only; the frontend applies everything anyway.
  }
};
