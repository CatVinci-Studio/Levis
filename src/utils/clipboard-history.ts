import { useSyncExternalStore } from "react";
import { loadSettings } from "../settings/SettingsContext";

/**
 * Rolling history of text that moved through the clipboard inside the
 * editor - both directions (copies/cuts made here and pastes arriving
 * here). Capped at the most recent 30 distinct entries; re-encountering a
 * known text just bumps it to the top. Persisted in localStorage so the
 * history survives restarts, and shared across windows via the storage
 * event (each window is its own SPA).
 *
 * Only clipboard traffic through the DOCUMENT is recorded - see
 * shouldCaptureFor: settings inputs (e.g. API keys) must never end up in a
 * plaintext history.
 */

export interface ClipboardEntry {
  text: string;
  at: number;
}

const STORAGE_KEY = "levis-clipboard-history";
const MAX_ENTRIES = 30;
const MAX_TEXT_LENGTH = 50_000;

let entries: ClipboardEntry[] = load();
const listeners = new Set<() => void>();

function load(): ClipboardEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is ClipboardEntry =>
          typeof e?.text === "string" && typeof e?.at === "number",
      )
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* quota/private mode - history just won't survive the session */
  }
}

function notify(): void {
  for (const fn of listeners) fn();
}

export function recordClipboardEntry(text: string): void {
  if (!loadSettings().enableClipboardHistory) return;
  const trimmed = text.trim();
  if (!trimmed || text.length > MAX_TEXT_LENGTH) return;
  entries = [
    { text, at: Date.now() },
    ...entries.filter((e) => e.text !== text),
  ].slice(0, MAX_ENTRIES);
  persist();
  notify();
}

export function clearClipboardHistory(): void {
  entries = [];
  persist();
  notify();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useClipboardHistory(): ClipboardEntry[] {
  return useSyncExternalStore(subscribe, () => entries);
}

/** Whether clipboard traffic on this event target belongs to the document
 *  (the WYSIWYG editor or the source-mode textarea) rather than some app
 *  chrome input like the settings panel's API-key field. */
function shouldCaptureFor(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(".milkdown, .source-view") !== null;
}

/** Copy/cut capture only applies to the source-mode textarea, where the DOM
 *  selection IS the markdown source. In the WYSIWYG editor
 *  `getSelection().toString()` drops hidden math source and the synthesized
 *  delimiter widgets - clipboard-history-plugin.ts records the serialized
 *  markdown from the editor state there instead. */
function shouldCaptureTextOf(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(".source-view") !== null;
}

/**
 * Installs the document-level capture listeners. Copy/cut snapshot the DOM
 * selection's text (the clipboardData of a copy event can't be read back);
 * paste reads the incoming text/plain. Returns the teardown.
 */
export function installClipboardCapture(): () => void {
  const onCopyOrCut = (e: ClipboardEvent) => {
    if (!shouldCaptureTextOf(e.target)) return;
    const text = document.getSelection()?.toString();
    if (text) recordClipboardEntry(text);
  };
  const onPaste = (e: ClipboardEvent) => {
    if (!shouldCaptureFor(e.target)) return;
    const text = e.clipboardData?.getData("text/plain");
    if (text) recordClipboardEntry(text);
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    entries = load();
    notify();
  };
  document.addEventListener("copy", onCopyOrCut, true);
  document.addEventListener("cut", onCopyOrCut, true);
  document.addEventListener("paste", onPaste, true);
  window.addEventListener("storage", onStorage);
  return () => {
    document.removeEventListener("copy", onCopyOrCut, true);
    document.removeEventListener("cut", onCopyOrCut, true);
    document.removeEventListener("paste", onPaste, true);
    window.removeEventListener("storage", onStorage);
  };
}
