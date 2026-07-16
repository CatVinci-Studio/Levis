import { useSyncExternalStore } from "react";

/**
 * Contextual coach-mark bubbles that surface once, the first time the user
 * does the thing they're about (e.g. selects text, before pressing the Ask
 * AI shortcut). "Seen" state, same pattern as chat-history.ts: a small
 * localStorage-backed external store so it survives restarts and stays in
 * sync across windows via the storage event.
 */
export type CoachMarkId = "askAi" | "completion";

const STORAGE_KEY = "levis-coach-marks-seen";
let seen: Set<CoachMarkId> = load();
const listeners = new Set<() => void>();

function load(): Set<CoachMarkId> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function store() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    // Not worth breaking anything over - coach marks would just repeat.
  }
}

function notify() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

window.addEventListener("storage", (e) => {
  if (e.key !== STORAGE_KEY) return;
  seen = load();
  notify();
});

export function isCoachMarkSeen(id: CoachMarkId): boolean {
  return seen.has(id);
}

export function markCoachMarkSeen(id: CoachMarkId) {
  if (seen.has(id)) return;
  seen = new Set(seen).add(id);
  store();
  notify();
}

/** "Skip all tips" - marks every known id seen at once. */
export function skipAllCoachMarks(ids: CoachMarkId[]) {
  seen = new Set([...seen, ...ids]);
  store();
  notify();
}

/** Re-arms every coach mark - used when relaunching the tutorial from Help. */
export function resetCoachMarks() {
  seen = new Set();
  store();
  notify();
}

export function useCoachMarksSeen(): Set<CoachMarkId> {
  return useSyncExternalStore(subscribe, () => seen);
}
