export interface ChatHeaderLabels {
  untitled: string;
  history: string;
  newChat: string;
  close: string;
}

interface ChatHeaderProps {
  title: string;
  /** Whether there's any saved conversation to browse - hides the history
   *  button entirely rather than showing it disabled. */
  hasHistory: boolean;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onNewChat: () => void;
  onClose: () => void;
  labels: ChatHeaderLabels;
}

/**
 * Always-rendered strip above the message list: the conversation's title,
 * and the history/new-chat/close controls that used to be a single
 * corner-anchored "new chat" button. Having history live here (instead of
 * only in the sidebar tab) is what makes the popup self-contained - opening
 * it and picking up a past conversation no longer requires the sidebar.
 */
export function ChatHeader({ title, hasHistory, historyOpen, onToggleHistory, onNewChat, onClose, labels }: ChatHeaderProps) {
  return (
    <div className="inline-chat-header">
      <span className="inline-chat-header-title">{title || labels.untitled}</span>
      <div className="inline-chat-header-actions">
        {hasHistory && (
          <button
            type="button"
            className={`inline-chat-header-btn${historyOpen ? " inline-chat-header-btn-active" : ""}`}
            title={labels.history}
            onClick={onToggleHistory}
          >
            ⏱
          </button>
        )}
        <button type="button" className="inline-chat-header-btn" title={labels.newChat} onClick={onNewChat}>
          +
        </button>
        <button type="button" className="inline-chat-header-btn" title={labels.close} onClick={onClose}>
          ✕
        </button>
      </div>
    </div>
  );
}
