import { ChatSurfaceBody, type ChatSurfaceProps } from "./ChatSurfaceBody";
import { useCloseConfirm } from "./CloseConfirm";
import "../AgentTurnView.css";
import "./inline-chat.css";
import "./chat-sidebar.css";

interface ChatSidebarProps extends ChatSurfaceProps {
  /** Pops the chat out into its own OS window (see chat-bridge.ts). */
  onDetach: () => void;
}

/// The DOCKED half of the chat's in-app surfaces: a fixed right-hand column
/// (portaled into EditorPane's chat dock) that squeezes the document aside
/// instead of floating over it - the home for anything longer than Quick
/// Ask's one-shot exchange. Same conversation object the Quick Ask popup
/// rendered, so expanding is just a re-render elsewhere.
///
/// Like the popup, this is only CHROME: a slim header (title, detach to an
/// OS window, close) around the shared ChatSurfaceBody.
export function ChatSidebar({ onDetach, ...surface }: ChatSidebarProps) {
  const confirm = useCloseConfirm(surface.pendingCount, surface.onClose);

  return (
    <div className="chat-sidebar">
      <div className="chat-sidebar-header">
        <span className="chat-sidebar-title">
          {surface.labels.sidebarTitle}
        </span>
        <div className="inline-chat-header-actions">
          <button
            type="button"
            className="inline-chat-header-button"
            aria-label={surface.labels.detach}
            title={surface.labels.detach}
            onClick={onDetach}
          >
            ⧉
          </button>
          <button
            type="button"
            className="inline-chat-header-button inline-chat-close"
            aria-label={surface.labels.close}
            title={surface.labels.close}
            onClick={confirm.requestClose}
          >
            ✕
          </button>
        </div>
      </div>
      <div className="chat-sidebar-body">
        <ChatSurfaceBody surface="dock" confirm={confirm} {...surface} />
      </div>
    </div>
  );
}
