import { useSyncExternalStore } from "react";
import type { AgentTurn } from "./types";
import { loadSettings } from "../settings/SettingsContext";

/**
 * Persisted agent conversations, so past chats can be reopened and continued
 * (the Chats sidebar panel). Stored in localStorage: small, synchronous, and
 * survives restarts; capped so it can't grow unbounded. Kept as a small
 * external store (same pattern as utils/clipboard-history.ts) so the sidebar
 * list re-renders live as conversations are saved or deleted.
 */
export interface ChatHistoryEntry {
  id: string;
  /** The document the conversation happened in, for the list's context line. */
  docPath: string | null;
  /** First user message, cleaned and truncated - the list's display name. */
  title: string;
  updatedAt: number;
  turns: AgentTurn[];
}

const STORAGE_KEY = "levis-chat-history";
const MAX_ENTRIES = 30;
const MAX_TITLE_CHARS = 60;

let entries: ChatHistoryEntry[] = load();
const listeners = new Set<() => void>();

function load(): ChatHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function store() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or storage unavailable - history is a convenience,
    // never worth breaking the chat over.
  }
}

function notify() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Other windows are their own SPA over the same localStorage - mirror their
// writes into this window's list.
window.addEventListener("storage", (e) => {
  if (e.key !== STORAGE_KEY) return;
  entries = load();
  notify();
});

/** Reactive view of the saved conversations, most recently active first. */
export function useChatHistory(): ChatHistoryEntry[] {
  return useSyncExternalStore(subscribe, () => entries);
}

/** Inserts or updates one conversation, dropping the stalest beyond the cap.
 *  A no-op while Settings > Privacy > Chat History is off. */
export function saveConversation(entry: ChatHistoryEntry) {
  if (!loadSettings().enableChatHistory) return;
  entries = [entry, ...entries.filter((e) => e.id !== entry.id)].slice(
    0,
    MAX_ENTRIES,
  );
  store();
  notify();
}

export function deleteConversation(id: string) {
  entries = entries.filter((e) => e.id !== id);
  store();
  notify();
}

export function clearAllConversations() {
  entries = [];
  store();
  notify();
}

/**
 * A display title from the first user turn: the outgoing message carries
 * context wrappers (<selected-text>, <attached-file>) that would drown out
 * what the user actually asked.
 */
export function conversationTitle(turns: AgentTurn[]): string {
  const first = turns.find((t) => t.kind === "User");
  if (!first || first.kind !== "User") return "";
  const cleaned = first.text
    .replace(/<selected-text>[\s\S]*?<\/selected-text>/g, "")
    .replace(/<attached-file[^>]*>[\s\S]*?<\/attached-file>/g, "")
    .replace(/\(If this asks you to rewrite[\s\S]*?\)\s*$/, "")
    .trim();
  const line = cleaned.split("\n").find((l) => l.trim()) ?? "";
  return line.length > MAX_TITLE_CHARS
    ? `${line.slice(0, MAX_TITLE_CHARS)}…`
    : line;
}
