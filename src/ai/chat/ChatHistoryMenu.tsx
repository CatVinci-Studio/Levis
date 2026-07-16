import { useChatHistory, deleteConversation, type ChatHistoryEntry } from "../chat-history";

interface ChatHistoryMenuProps {
  emptyLabel: string;
  deleteLabel: string;
  onRestore: (entry: ChatHistoryEntry) => void;
}

/**
 * The popup's own history browser (see ChatHeader's history button) -
 * restores a saved conversation directly via a prop call, not the
 * RESTORE_CHAT_EVENT round-trip the sidebar's Chats tab uses (App.tsx keeps
 * that tab too, as a second entry point; this one and the sidebar list read
 * the same chat-history.ts store, so they can never disagree).
 */
export function ChatHistoryMenu({ emptyLabel, deleteLabel, onRestore }: ChatHistoryMenuProps) {
  const entries = useChatHistory();

  if (entries.length === 0) {
    return (
      <div className="inline-chat-history-menu floating-surface">
        <div className="inline-chat-history-empty">{emptyLabel}</div>
      </div>
    );
  }

  return (
    <div className="inline-chat-history-menu floating-surface">
      {entries.map((entry) => (
        <div key={entry.id} className="inline-chat-history-entry" onClick={() => onRestore(entry)}>
          <div className="inline-chat-history-entry-main">
            <span className="inline-chat-history-entry-title">{entry.title || "…"}</span>
            <span className="inline-chat-history-entry-meta">
              {new Date(entry.updatedAt).toLocaleString()}
              {entry.docPath ? ` · ${entry.docPath.split("/").pop()}` : ""}
            </span>
          </div>
          <button
            className="inline-chat-history-entry-delete"
            title={deleteLabel}
            onClick={(e) => {
              e.stopPropagation();
              deleteConversation(entry.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
