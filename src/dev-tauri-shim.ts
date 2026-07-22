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
      if (
        cmd === "plugin:event|listen" &&
        args?.event &&
        typeof args.handler === "number"
      ) {
        listeners.set(args.event, [
          ...(listeners.get(args.event) ?? []),
          args.handler,
        ]);
        // The listener id unlisten() later passes to unregisterListener -
        // returning null here would make every unlisten a no-op and stale
        // StrictMode handlers would double-fire events.
        return Promise.resolve(args.handler);
      }
      // A canned suggestion instead of null: lets ghost-text rendering (and
      // the tutorial's completion step) be smoke-tested in the browser -
      // null would make the manual trigger path throw an error dialog.
      if (cmd === "ai_complete") {
        return Promise.resolve(
          " and this ghost text is a canned dev-shim suggestion.",
        );
      }
      // One canned issue on the paragraph's first character, so the
      // underline decoration and hover popover can be smoke-tested too.
      if (cmd === "ai_grammar_check") {
        const paragraph =
          (args as unknown as { paragraph?: string })?.paragraph ?? "";
        return Promise.resolve(
          paragraph.length > 0
            ? [
                {
                  start: 0,
                  end: 1,
                  issue: "Canned dev-shim issue.",
                  suggestion: paragraph[0].toUpperCase(),
                },
              ]
            : [],
        );
      }
      // A canned User/Assistant exchange (AgentTurn[]) instead of null - lets
      // the inline chat's real send path (not just the tutorial's own
      // mockReply) be smoke-tested in the browser; null here made
      // useAgentConversation's `[...prev, ...newTurns]` throw (newTurns not
      // iterable) and crash the whole tree, since there's no error boundary.
      // The reply is also drip-fed through the onEvent channel first, so the
      // streaming render path gets exercised without a real provider. In
      // this shim, invoke() receives the raw args object, so onEvent is the
      // live Channel instance and its onmessage handler is callable.
      if (cmd === "ai_agent_message") {
        const { message = "", onEvent } =
          (args as unknown as {
            message?: string;
            onEvent?: { onmessage?: (event: unknown) => void };
          }) ?? {};
        const reply = `Canned dev-shim reply to: ${message}`;
        return new Promise((resolve) => {
          let sent = 0;
          const timer = setInterval(() => {
            const next = Math.min(sent + 3, reply.length);
            onEvent?.onmessage?.({
              type: "delta",
              text: reply.slice(sent, next),
            });
            sent = next;
            if (sent >= reply.length) {
              clearInterval(timer);
              resolve([
                { kind: "User", text: message },
                { kind: "Assistant", text: reply },
              ]);
            }
          }, 30);
        });
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
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((h) => h !== id),
      );
    },
  };
  w.__devEmitTauriEvent = (event: string, payload?: unknown) => {
    for (const id of listeners.get(event) ?? []) {
      (w[`_${id}`] as ((e: unknown) => void) | undefined)?.({
        event,
        id,
        payload,
      });
    }
  };
}
