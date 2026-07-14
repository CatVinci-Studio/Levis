import { useSettings } from "../settings/SettingsContext";
import { useChatHistory, deleteConversation } from "../ai/chat-history";
import { RESTORE_CHAT_EVENT } from "../utils/events";

/**
 * Sidebar panel over the saved agent conversations (see ai/chat-history.ts).
 * Clicking an entry restores it as the live conversation and opens the
 * inline chat bar in the editor (via RESTORE_CHAT_EVENT - same decoupling
 * as the clipboard panel's insert event).
 */
export function ChatHistory() {
  const { t } = useSettings();
  const entries = useChatHistory();

  if (entries.length === 0) {
    return <div className="clipboard-empty">{t.chatHistoryEmpty}</div>;
  }

  return (
    <div className="chat-history">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="chat-history-entry"
          title={t.chatHistoryRestoreHint}
          onClick={() => window.dispatchEvent(new CustomEvent(RESTORE_CHAT_EVENT, { detail: entry }))}
        >
          <div className="chat-history-entry-main">
            <span className="chat-history-entry-title">{entry.title || "…"}</span>
            <span className="chat-history-entry-meta">
              {new Date(entry.updatedAt).toLocaleString()}
              {entry.docPath ? ` · ${entry.docPath.split("/").pop()}` : ""}
            </span>
          </div>
          <button
            className="chat-history-entry-delete"
            title={t.chatHistoryDelete}
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
