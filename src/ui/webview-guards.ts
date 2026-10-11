/**
 * Turns off the parts of the browser engine that show through in a desktop
 * app. Release builds only - in development both are how you inspect and
 * reload the page.
 *
 * - The engine's own right-click menu (WebKitGTK's "Reload", WebView2's
 *   Back/Refresh/Print) appeared anywhere the app hadn't drawn its own: the
 *   sidebar, tab bar, Settings, chat. Text fields keep it - that is where
 *   Cut/Copy/Paste and spelling suggestions live. The editor already shows
 *   its own menu (MilkdownEditor) and prevents this one itself.
 * - F5 and Ctrl/Cmd+R reload the page, which throws away every open tab's
 *   unsaved edits and undo history; draft autosave only softens that.
 *   Bubble phase, after useGlobalShortcuts' capture-phase handler (which
 *   skips default-prevented events), so a user who binds Ctrl+R to a
 *   command in Settings still gets it.
 */
export function installWebviewGuards(): void {
  if (import.meta.env.DEV) return;

  window.addEventListener("contextmenu", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable='true']")) return;
    event.preventDefault();
  });

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const reload =
      key === "f5" ||
      (key === "r" && (event.ctrlKey || event.metaKey) && !event.altKey);
    if (reload) event.preventDefault();
  });
}
