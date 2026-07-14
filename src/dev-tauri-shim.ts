/**
 * Dev-only stub of the Tauri IPC globals so the editor can be smoke-tested
 * in a plain browser at http://localhost:1420. Without it, the first
 * `invoke()`/`getCurrentWindow()` call in App's mount effects throws and
 * React unmounts the whole tree (there's no error boundary), leaving a
 * blank page. Every command resolves to null and native events never fire -
 * anything actually exercising native behavior still needs the real app.
 *
 * Event listeners ARE tracked, though: `window.__devEmitTauriEvent(name,
 * payload)` fires them, so menu-driven features (Settings, Help docs, ...)
 * can be driven from the console / browser automation.
 */
export function installDevTauriShim(): void {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as Record<string, unknown>;
  if ("__TAURI_INTERNALS__" in w) return; // real Tauri runtime present

  let nextCallbackId = 1;
  // event name -> handler callback ids (as registered via transformCallback)
  const listeners = new Map<string, number[]>();

  w.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    invoke: (cmd: string, args?: { event?: string; handler?: number }) => {
      if (cmd === "plugin:event|listen" && args?.event && typeof args.handler === "number") {
        listeners.set(args.event, [...(listeners.get(args.event) ?? []), args.handler]);
        // The listener id unlisten() later passes to unregisterListener -
        // returning null here would make every unlisten a no-op and stale
        // StrictMode handlers would double-fire events.
        return Promise.resolve(args.handler);
      }
      return Promise.resolve(null);
    },
    // Mirrors the real runtime: the callback is parked on window under
    // `_<id>` so it can be invoked by id later.
    transformCallback: (cb?: (response: unknown) => void) => {
      const id = nextCallbackId++;
      w[`_${id}`] = cb ?? (() => {});
      return id;
    },
    unregisterCallback: () => {},
    plugins: {},
  };
  // The event plugin calls this from unlisten() - without it, React
  // StrictMode's mount/cleanup/mount cycle leaves stale handlers behind and
  // one __devEmitTauriEvent fires them all (symptom: duplicated tabs).
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (event: string, id: number) => {
      listeners.set(event, (listeners.get(event) ?? []).filter((h) => h !== id));
    },
  };
  w.__devEmitTauriEvent = (event: string, payload?: unknown) => {
    for (const id of listeners.get(event) ?? []) {
      (w[`_${id}`] as ((e: unknown) => void) | undefined)?.({ event, id, payload });
    }
  };
}
