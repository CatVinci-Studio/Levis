import { useSyncExternalStore } from "react";
import { storage, type HistoryKind } from "../ipc";
import { legacyImportSettled, readBoot, readLocalJson } from "../storage/boot";
import { listenToThisWindow } from "./tauri-events";

/**
 * A small persisted list exposed as an external store, for the histories
 * (clipboard, chat) that must survive restarts and stay in sync across
 * windows - each window is its own SPA, so a change made in one has to
 * reach the others.
 *
 * Kept by Rust in a JSON file per list (src-tauri/src/settings.rs,
 * docs/STORAGE.md), changed one entry at a time - upsert, remove, clear -
 * and never by writing the whole array back: two windows saving different
 * conversations at once must both land. Rust broadcasts each change and
 * every other window applies the same operation to its copy.
 *
 * Without Rust behind the page (the browser dev shim, vitest) the list
 * lives in localStorage under `key`, as it did before the move, and other
 * windows hear of a write through the storage event.
 *
 * What comes back from storage is untrusted (an older build's shape, a
 * hand edit), so every entry passes `isEntry` on load.
 */
export function createPersistedList<T>(
  key: string,
  options: {
    kind: HistoryKind;
    max: number;
    isEntry: (value: unknown) => value is T;
    /** What makes two entries the same one (Rust's HistoryKind::key_of). */
    keyOf: (entry: T) => string;
    /** Order kept on every change, e.g. most recent first. */
    sort?: (a: T, b: T) => number;
  },
) {
  const listeners = new Set<() => void>();
  let entries: T[] = [];
  let started = false;
  /** File mode: operations since the last list request went out, replayed
   *  onto its answer - which may predate them. All three are idempotent, so
   *  one that IS already in the answer comes out the same. */
  let sinceRequest: Op<T>[] | null = null;

  function tidy(list: unknown[]): T[] {
    const valid = list.filter(options.isEntry);
    if (options.sort) valid.sort(options.sort);
    return valid.slice(0, options.max);
  }

  function apply(list: T[], op: Op<T>): T[] {
    switch (op.type) {
      case "upsert": {
        const k = options.keyOf(op.entry);
        return tidy([op.entry, ...list.filter((e) => options.keyOf(e) !== k)]);
      }
      case "remove":
        return list.filter((e) => options.keyOf(e) !== op.key);
      case "clear":
        return [];
    }
  }

  function notify() {
    for (const fn of listeners) fn();
  }

  function loadLocal(): T[] {
    const parsed = readLocalJson(key);
    return Array.isArray(parsed) ? tidy(parsed) : [];
  }

  function fetchList() {
    sinceRequest = [];
    void legacyImportSettled()
      .then(() => storage.historyList(options.kind))
      .then((list) => {
        let next = tidy(Array.isArray(list) ? list : []);
        for (const op of sinceRequest ?? []) next = apply(next, op);
        sinceRequest = null;
        entries = next;
        notify();
      })
      .catch(() => {
        sinceRequest = null;
      });
  }

  function start() {
    if (started) return;
    started = true;
    const boot = readBoot();
    if (!boot) {
      entries = loadLocal();
      if (typeof window !== "undefined") {
        window.addEventListener("storage", (e) => {
          if (e.key !== key) return;
          entries = loadLocal();
          notify();
        });
      }
      return;
    }
    void listenToThisWindow<HistoryChanged<T>>("history-changed", (event) => {
      const { kind, op, from } = event.payload;
      if (kind !== options.kind) return;
      if (op.type === "reload") return fetchList();
      // This window's own change, already applied when it was made.
      if (from === boot.label) return;
      sinceRequest?.push(op);
      entries = apply(entries, op);
      notify();
    });
    fetchList();
  }

  /** Applies `op` here at once, then hands it to the store behind. */
  function change(op: Op<T>) {
    start();
    entries = apply(entries, op);
    if (readBoot()) {
      sinceRequest?.push(op);
      const sent =
        op.type === "upsert"
          ? storage.historyUpsert(options.kind, op.entry)
          : op.type === "remove"
            ? storage.historyRemove(options.kind, op.key)
            : storage.historyClear(options.kind);
      // A history is a convenience: a failed write just won't survive
      // the session.
      sent.catch(() => {});
    } else {
      try {
        localStorage.setItem(key, JSON.stringify(entries));
      } catch {
        // Quota exceeded or storage unavailable - same as above.
      }
    }
    notify();
  }

  function subscribe(fn: () => void): () => void {
    start();
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    get: (): T[] => {
      start();
      return entries;
    },
    /** Adds `entry`, or replaces the one with the same key, at the front
     *  (then `sort` and the cap apply). */
    upsert: (entry: T) => change({ type: "upsert", entry }),
    remove: (entryKey: string) => change({ type: "remove", key: entryKey }),
    clear: () => change({ type: "clear" }),
    useEntries: (): T[] => useSyncExternalStore(subscribe, () => entries),
  };
}

type Op<T> =
  | { type: "upsert"; entry: T }
  | { type: "remove"; key: string }
  | { type: "clear" };

/** Mirrors HistoryChanged in src-tauri/src/settings.rs. */
interface HistoryChanged<T> {
  kind: HistoryKind;
  op: Op<T> | { type: "reload" };
  from: string;
}
