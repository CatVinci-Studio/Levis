/**
 * How much of the window frame this app has to draw for itself.
 *
 * Both desktop platforms end up with the SAME shape - one 28px row at the
 * top of the webview, and nothing else (see `.window-bar` in App.css) - but
 * they get there from opposite directions, which is the whole reason this
 * flag exists:
 *
 * - macOS has an overlay title-bar style. The window keeps its native frame
 *   and its native buttons; the traffic lights simply float over our row.
 *   Nothing here to draw.
 * - Windows has no such style. Its native title bar cannot be made to host
 *   our row, and the app menu is a second native bar under it, so the window
 *   was showing three stacked strips. The fix is to drop the native frame
 *   entirely - which means the caption buttons and the way into the menu
 *   become ours to draw (WindowControls.tsx).
 *
 * Mirrors `build_with_app_chrome` and `hide_native_menu_bar` in
 * src-tauri/src/lib.rs; the two must agree, or the window either loses its
 * close button or grows a second one.
 */

/** `navigator.platform` is "Win32"/"Win64" even on 64-bit Windows; the UA
 *  check is the fallback for runtimes that have stopped reporting platform.
 *  Same detection style as utils/shortcuts.ts uses for macOS. */
function detectWindows(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /^win/i.test(navigator.platform ?? "") ||
    /windows/i.test(navigator.userAgent)
  );
}

/**
 * Whether the OS frame is gone and the app owns the caption.
 *
 * Read once at module load: a window does not migrate between operating
 * systems, and making it a hook would mean every consumer re-rendering for a
 * value that cannot change.
 */
export const appDrawsWindowFrame = detectWindows();

/**
 * Publishes {@link appDrawsWindowFrame} to CSS as `data-window-chrome` on
 * <html>, so the stylesheet can drop the macOS traffic-light inset and make
 * room for the caption buttons without every rule needing a class threaded
 * down to it. Called once from main.tsx, before the first render, so the
 * title row is never painted at the wrong inset and then corrected.
 */
export function publishWindowChrome(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.windowChrome = appDrawsWindowFrame
    ? "app"
    : "native";
}
