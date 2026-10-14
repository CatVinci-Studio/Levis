import type { AgentTurn } from "./types";
import { userMessageBody } from "./chat/user-message";
import { loadSettings } from "../settings/SettingsContext";
import { createPersistedList } from "../utils/persisted-list";
import { CHAT_HISTORY_KEY } from "../storage/legacy-import";

/**
 * Persisted agent conversations, so past chats can be reopened and continued
 * (the Chats sidebar panel). Kept by Rust in chat-history.json and capped
 * so it can't grow unbounded. A persisted list (utils/persisted-list.ts) so
 * the sidebar list re-renders live as conversations are saved or deleted,
 * in every window.
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

const MAX_ENTRIES = 60;
const MAX_TITLE_CHARS = 60;

const history = createPersistedList<ChatHistoryEntry>(CHAT_HISTORY_KEY, {
  kind: "chat",
  max: MAX_ENTRIES,
  keyOf: (entry) => entry.id,
  isEntry: (e): e is ChatHistoryEntry => {
    const entry = e as ChatHistoryEntry;
    return (
      typeof entry?.id === "string" &&
      typeof entry.updatedAt === "number" &&
      Array.isArray(entry.turns)
    );
  },
  sort: (a, b) => b.updatedAt - a.updatedAt,
});

/** Reactive view of the saved conversations, most recently active first. */
export function useChatHistory(): ChatHistoryEntry[] {
  return history.useEntries();
}

/** Inserts or updates one conversation, dropping the stalest beyond the cap.
 *  A no-op while Settings > Privacy > Chat History is off. */
export function saveConversation(entry: ChatHistoryEntry) {
  if (!loadSettings().enableChatHistory) return;
  history.upsert(entry);
}

export function deleteConversation(id: string) {
  history.remove(id);
}

export function clearAllConversations() {
  history.clear();
}

/**
 * A display title from the first user turn: the outgoing message carries
 * context wrappers (<selected-text>, <attached-file>) that would drown out
 * what the user actually asked.
 */
export function conversationTitle(turns: AgentTurn[]): string {
  const first = turns.find((t) => t.kind === "User");
  if (!first || first.kind !== "User") return "";
  // The context blocks are stripped by the one module that owns their
  // format (user-message.ts), not by a third copy of the regexes.
  const cleaned = userMessageBody(first.text)
    .replace(/\(If this asks you to rewrite[\s\S]*?\)\s*$/, "")
    .trim();
  const line = cleaned.split("\n").find((l) => l.trim()) ?? "";
  return line.length > MAX_TITLE_CHARS
    ? `${line.slice(0, MAX_TITLE_CHARS)}…`
    : line;
}
