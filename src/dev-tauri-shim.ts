/**
 * Dev-only stub of the Tauri IPC globals so the editor can be smoke-tested
 * in a plain browser at http://localhost:1420. Without it, the first
 * `invoke()`/`getCurrentWindow()` call in App's mount effects throws and
 * React unmounts the whole tree (there's no error boundary), leaving a
 * blank page. Every command resolves to null and events never fire -
 * anything actually exercising native behavior still needs the real app.
 */
export function installDevTauriShim(): void {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as Record<string, unknown>;
  if ("__TAURI_INTERNALS__" in w) return; // real Tauri runtime present

  let nextCallbackId = 1;
  w.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    invoke: () => Promise.resolve(null),
    transformCallback: () => nextCallbackId++,
    unregisterCallback: () => {},
    plugins: {},
  };
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: () => {},
  };
}
