import type { AgentConversation } from "../useAgentConversation";
import type { PendingStatus } from "../usePendingEdits";
import type { EditProposal } from "../types";
import { ChatBody } from "./ChatBody";
import { CloseConfirmBar, useCloseConfirm } from "./CloseConfirm";
import type { InlineChatLabels } from "./InlineChat";
import "../AgentTurnView.css";
import "./inline-chat.css";
import "./chat-sidebar.css";

interface ChatSidebarProps {
  document: string;
  selectedText: string | null;
  selectionMarkdown: string | null;
  docPath: string | null;
  conversation: AgentConversation;
  tutorialMock?: boolean;
  labels: InlineChatLabels;
  onProposals: (
    proposals: { callId: string; proposal: EditProposal }[],
  ) => void;
  proposalStatus: (callId: string) => PendingStatus;
  onAcceptProposal: (callId: string) => void;
  onRejectProposal: (callId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  pendingCount: number;
  onRevealPending: () => void;
  /** Pops the chat out into its own OS window (see chat-bridge.ts). */
  onDetach: () => void;
  onClose: () => void;
}

/// The DOCKED half of the chat's in-app surfaces: a fixed right-hand column
/// (portaled into EditorPane's chat dock) that squeezes the document aside
/// instead of floating over it - the home for anything longer than Quick
/// Ask's one-shot exchange. Same ChatBody, same conversation object the
/// Quick Ask popup rendered, so expanding is just a re-render elsewhere.
///
/// Like the popup, this is only CHROME: a slim header (title, detach to an
/// OS window, close) around the shared ChatBody.
export function ChatSidebar({
  document,
  selectedText,
  selectionMarkdown,
  docPath,
  conversation,
  tutorialMock,
  labels,
  onProposals,
  proposalStatus,
  onAcceptProposal,
  onRejectProposal,
  onAcceptAll,
  onRejectAll,
  pendingCount,
  onRevealPending,
  onDetach,
  onClose,
}: ChatSidebarProps) {
  const confirm = useCloseConfirm(pendingCount, onClose);

  return (
    <div className="chat-sidebar">
      <div className="chat-sidebar-header">
        <span className="chat-sidebar-title">{labels.sidebarTitle}</span>
        <div className="inline-chat-header-actions">
          <button
            type="button"
            className="inline-chat-header-button"
            aria-label={labels.detach}
            title={labels.detach}
            onClick={onDetach}
          >
            ⧉
          </button>
          <button
            type="button"
            className="inline-chat-header-button inline-chat-close"
            aria-label={labels.close}
            title={labels.close}
            onClick={confirm.requestClose}
          >
            ✕
          </button>
        </div>
      </div>
      <div className="chat-sidebar-body">
        <ChatBody
          document={document}
          selectedText={selectedText}
          selectionMarkdown={selectionMarkdown}
          docPath={docPath}
          conversation={conversation}
          tutorialMock={tutorialMock}
          labels={labels}
          proposalStatus={proposalStatus}
          pendingCount={pendingCount}
          onProposals={onProposals}
          onAcceptProposal={onAcceptProposal}
          onRejectProposal={onRejectProposal}
          onAcceptAll={onAcceptAll}
          onRejectAll={onRejectAll}
          onEscape={confirm.requestClose}
          onRevealPending={onRevealPending}
          fillHeight
          footer={
            confirm.confirming && (
              <CloseConfirmBar
                labels={labels}
                pendingCount={pendingCount}
                onAcceptAll={onAcceptAll}
                onRejectAll={onRejectAll}
                onClose={onClose}
                onCancel={confirm.cancel}
              />
            )
          }
        />
      </div>
    </div>
  );
}
