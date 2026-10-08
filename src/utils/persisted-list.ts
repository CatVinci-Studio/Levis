import { useSyncExternalStore } from "react";

/**
 * A small list persisted in localStorage and exposed as an external store,
 * for the histories (clipboard, chat) that must survive restarts and stay
 * in sync across windows - each window is its own SPA over the same
 * localStorage, so another window's write arrives as a storage event.
 *
 * What comes back from storage is untrusted (an older build's shape, a
 * hand edit), so every entry passes `isEntry` on load.
 */
export function createPersistedList<T>(
  key: string,
  options: {
    max: number;
    isEntry: (value: unknown) => value is T;
    /** Order applied on load, e.g. most recent first. */
    sort?: (a: T, b: T) => number;
  },
) {
  const listeners = new Set<() => void>();

  function load(): T[] {
    try {
      const raw = localStorage.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      const valid = parsed.filter(options.isEntry);
      if (options.sort) valid.sort(options.sort);
      return valid.slice(0, options.max);
    } catch {
      return [];
    }
  }

  let entries = load();

  function notify() {
    for (const fn of listeners) fn();
  }

  function subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key !== key) return;
      entries = load();
      notify();
    });
  }

  return {
    get: (): T[] => entries,
    /** Replaces the list (capped at `max`), persists it and notifies. */
    set(next: T[]) {
      entries = next.slice(0, options.max);
      try {
        localStorage.setItem(key, JSON.stringify(entries));
      } catch {
        // Quota exceeded or storage unavailable - a history is a
        // convenience; it just won't survive the session.
      }
      notify();
    },
    useEntries: (): T[] => useSyncExternalStore(subscribe, () => entries),
  };
}
