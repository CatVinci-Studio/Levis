/** Shared OS detection for shortcut dispatch, labels, and native features. */
export function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /mac/i.test(navigator.platform || navigator.userAgent)
  );
}

/**
 * Whether the Mod key of a shortcut ("mod+f", ProseMirror's "Mod-Enter") is
 * Cmd rather than Ctrl: on a Mac, and on an iPhone, iPad or iPod with a
 * hardware keyboard. An iPhone's platform string says "iPhone", and an
 * iPad's says "iPad" whenever WebKit gives it the mobile content mode (in
 * the desktop-class one it says "MacIntel", see isIOSPlatform) - not "Mac",
 * so isMacPlatform() says no there, yet the keyboard has a Cmd key and the
 * user expects it. Decided exactly as ProseMirror's keymap decides it, so
 * the app's own shortcuts and the editor's Mod-bindings always agree.
 */
export function modIsMeta(
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): boolean {
  return /Mac|iP(hone|[oa]d)/.test(platform ?? "");
}

/** Windows. `navigator.platform` is "Win32" even on 64-bit Windows; the UA
 *  check is the fallback for runtimes that stopped reporting platform. */
export function isWindowsPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /^win/i.test(navigator.platform ?? "") ||
    /windows/i.test(navigator.userAgent)
  );
}

/** Linux desktop builds; Android also reports "Linux" and is excluded. */
export function isLinuxPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /linux/i.test(navigator.platform ?? "") &&
    !/android/i.test(navigator.userAgent)
  );
}

/** iOS and iPadOS - the Tauri iOS app's WKWebView. An iPhone reports
 *  "iPhone" as its platform. An iPad, though, gets the desktop-class
 *  WebKit user agent by default and reports "MacIntel" like a real Mac; the
 *  tell is the touch screen, which no Mac has (`maxTouchPoints` is 0 there,
 *  5 on an iPad). */
export function isIOSPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform ?? "";
  if (/^(iPhone|iPad|iPod)/.test(platform)) return true;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return true;
  return platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1;
}

/** A desktop build (macOS, Windows, Linux): everything that isn't the iOS
 *  app (or an Android webview, which Levis doesn't ship but which must
 *  never be mistaken for desktop Linux). The Rust side's `cfg(desktop)`. */
export function isDesktop(): boolean {
  if (typeof navigator === "undefined") return true;
  return !isIOSPlatform() && !/android/i.test(navigator.userAgent);
}
