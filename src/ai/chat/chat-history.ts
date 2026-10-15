import { useEffect, useMemo, useState } from "react";
import type { AgentTurn } from "../types";
import { userMessageBody } from "./user-message";
import { loadSettings } from "../../settings/SettingsContext";
import { createPersistedList } from "../../utils/persisted-list";
import { CHAT_HISTORY_KEY } from "../../storage/legacy-import";
import { isIOSApp } from "../../platform/capabilities";
import {
  documentsDir,
  knownDocumentsDir,
  resolvedDocumentPath,
  storedDocumentPath,
} from "../../platform/documents-path";

/**
 * Persisted agent conversations, so past chats can be reopened and continued
 * (the Chats sidebar panel). Kept by Rust in chat-history.json and capped
 * so it can't grow unbounded. A persisted list (utils/persisted-list.ts) so
 * the sidebar list re-renders live as conversations are saved or deleted,
 * in every window.
 */
export interface ChatHistoryEntry {
  id: string;
  /** The document the conversation happened in, for the list's context line
   *  and its project group. On iOS one in the app's Documents folder is
   *  stored relative to it ("documents:...", platform/documents-path.ts) -
   *  the folder moves with every reinstall and update - and handed out
   *  resolved again by useChatHistory. */
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
  // iOS: the document path relative to Documents, on every save - and for
  // what an earlier version stored absolute, rewritten once when the list
  // loads, so its conversations join their documents' group again.
  normalise: isIOSApp ? storedEntry : undefined,
});

/** `entry` with its document path in the stored form (see docPath). */
export function storedEntry(entry: ChatHistoryEntry): ChatHistoryEntry {
  if (!entry.docPath) return entry;
  const docPath = storedDocumentPath(entry.docPath, knownDocumentsDir());
  return docPath === entry.docPath ? entry : { ...entry, docPath };
}

/** `entry` with a stored document path resolved against Documents `docs`. */
export function resolvedEntry(
  entry: ChatHistoryEntry,
  docs: string,
): ChatHistoryEntry {
  if (!entry.docPath) return entry;
  const docPath = resolvedDocumentPath(entry.docPath, docs);
  return docPath === entry.docPath ? entry : { ...entry, docPath };
}

// Asked early, so a save can tell the Documents folder from a path that
// merely looks like one, and the list rarely renders before it is known.
if (isIOSApp) void documentsDir().catch(() => {});

/** iOS: the Documents folder, once known; always null elsewhere. */
function useDocumentsDir(): string | null {
  const [docs, setDocs] = useState(knownDocumentsDir);
  useEffect(() => {
    if (!isIOSApp || docs) return;
    let live = true;
    documentsDir()
      .then((dir) => {
        if (live) setDocs(dir);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [docs]);
  return docs;
}

/** Reactive view of the saved conversations, most recently active first,
 *  with their document paths as the rest of the app knows them. */
export function useChatHistory(): ChatHistoryEntry[] {
  const entries = history.useEntries();
  const docs = useDocumentsDir();
  return useMemo(
    () =>
      isIOSApp && docs
        ? entries.map((entry) => resolvedEntry(entry, docs))
        : entries,
    [entries, docs],
  );
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
