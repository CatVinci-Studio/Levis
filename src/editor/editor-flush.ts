// Milkdown's listener reports markdown on a 200ms trailing debounce with no
// maxWait, so a typing burst - an IME session especially - can keep the
// tab's `content` behind the live document for as long as it lasts. Anything
// that acts on `content` (save, close prompt, detach, source mode, disk
// reload) must first pull the live document through here; otherwise Save
// writes the pre-burst text, and a remount (reloadKey) or unmount cancels
// the pending debounce, losing the burst outright.

type Flusher = () => string | null;

const flushers = new Map<string, Flusher>();

/** Registers the mounted editor of `tabId`; returns the unregister call. */
export function registerEditorFlush(tabId: string, flush: Flusher) {
  flushers.set(tabId, flush);
  return () => {
    if (flushers.get(tabId) === flush) flushers.delete(tabId);
  };
}

/**
 * Pushes any not-yet-reported edit of `tabId`'s editor through its
 * onChange synchronously and returns the live markdown - or null when the
 * tab has no mounted editor or nothing was ever edited, in which case the
 * tab's own `content` is already current.
 */
export function flushEditor(tabId: string): string | null {
  return flushers.get(tabId)?.() ?? null;
}
