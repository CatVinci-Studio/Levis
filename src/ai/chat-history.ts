import type { AgentTurn } from "./types";

/**
 * Persisted agent conversations, so past chats can be reopened and continued
 * (the History button in InlineChatBar). Stored in localStorage: small,
 * synchronous, and survives restarts; capped so it can't grow unbounded.
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

function load(): ChatHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function store(entries: ChatHistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or storage unavailable - history is a convenience,
    // never worth breaking the chat over.
  }
}

/** All saved conversations, most recently active first. */
export function listConversations(): ChatHistoryEntry[] {
  return load().sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Inserts or updates one conversation, dropping the stalest beyond the cap. */
export function saveConversation(entry: ChatHistoryEntry) {
  const rest = load().filter((e) => e.id !== entry.id);
  rest.sort((a, b) => b.updatedAt - a.updatedAt);
  store([entry, ...rest].slice(0, MAX_ENTRIES));
}

/**
 * A display title from the first user turn: the outgoing message carries
 * context wrappers (<selected-text>, <attached-file>) and an instruction
 * footnote that would drown out what the user actually asked.
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
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS)}…` : line;
}
