import type { ReactNode } from "react";
import { CloseIcon, DetachIcon, PlusIcon } from "../../ui/icons";

export interface AgentPanelLabels {
  title: string;
  newConversation: string;
  popOut: string;
  close: string;
}

/**
 * The docked panel's chrome: a header naming the panel and the document the
 * conversation belongs to, with new / pop out / close, over the chat body
 * (ChatBody, variant "full") its editor renders into `children`. Purely
 * presentational - the editor owns the conversation and wires the actions.
 */
export function AgentPanelView({
  labels,
  onNewConversation,
  onPopOut,
  onClose,
  headerExtra,
  children,
}: {
  labels: AgentPanelLabels;
  onNewConversation: () => void;
  onPopOut: () => void;
  onClose: () => void;
  /** A second header row (the project folder chip). */
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="agent-panel-view" aria-label={labels.title}>
      <header className="agent-panel-header">
        <div className="agent-panel-heading">
          <span className="agent-panel-title">{labels.title}</span>
        </div>
        <div className="agent-panel-actions">
          <button
            type="button"
            className="inline-chat-header-button"
            aria-label={labels.newConversation}
            title={labels.newConversation}
            onClick={onNewConversation}
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            className="inline-chat-header-button"
            aria-label={labels.popOut}
            title={labels.popOut}
            onClick={onPopOut}
          >
            <DetachIcon />
          </button>
          <button
            type="button"
            className="inline-chat-header-button"
            aria-label={labels.close}
            title={labels.close}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
      </header>
      {headerExtra}
      <div className="agent-panel-body">{children}</div>
    </section>
  );
}
