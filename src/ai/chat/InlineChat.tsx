import type { AgentConversation } from "../useAgentConversation";
import type { PendingStatus } from "../usePendingEdits";
import type { EditProposal } from "../types";
import { ChatBody, type ChatBodyLabels } from "./ChatBody";
import {
  CloseConfirmBar,
  useCloseConfirm,
  type CloseConfirmLabels,
} from "./CloseConfirm";
import "../AgentTurnView.css";
import "./inline-chat.css";

export interface InlineChatLabels extends ChatBodyLabels, CloseConfirmLabels {
  /** Accessible name / tooltip of the header's close button. */
  close: string;
  /** Accessible name / tooltip of the pop-out-to-OS-window button. */
  detach: string;
}

interface InlineChatProps {
  document: string;
  selectedText: string | null;
  selectionMarkdown: string | null;
  /** The document's path - resolves the agent workspace (skills, files). */
  docPath: string | null;
  /** Conversation state owned by the editor so it can be saved after close;
   *  a normal subsequent open resets it, while history restores resume it. */
  conversation: AgentConversation;
  /** This chat is the onboarding tour's mock conversation - the only one
   *  whose sends/proposals may advance the tour. */
  tutorialMock?: boolean;
  labels: InlineChatLabels;
  onProposals: (
    proposals: { callId: string; proposal: EditProposal }[],
  ) => void;
  /** Live status of a propose_edit call_id, from usePendingEdits.status. */
  proposalStatus: (callId: string) => PendingStatus;
  onAcceptProposal: (callId: string) => void;
  onRejectProposal: (callId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  pendingCount: number;
  /** Scrolls the editor to the first pending edit. */
  onRevealPending: () => void;
  /** Pops the full conversation out into its own OS window (chat-bridge) -
   *  the explicit, user-initiated escalation path from this one-shot bar. */
  onDetach: () => void;
  onClose: () => void;
}

/// QUICK ASK - the in-document half of the chat's two surfaces (the other
/// is the detached OS window), modeled on VS Code's inline chat.
///
/// It renders as a ZONE WIDGET: a block portaled into the document flow
/// right after the block the chat was opened on (quick-ask-widget-plugin),
/// so the content below is pushed down, never covered, and the panel
/// follows its block through edits. It is a command bar, not a chat log:
/// an instruction produces previews in the document plus the pending bar
/// (the ONE in-app place edits are confirmed); a question produces a
/// one-line reply summary with "open the full conversation" (detach)
/// beside it. The conversation itself is never rendered here.
///
/// This file is only the panel's CHROME: the header and the close
/// confirmation. The body is ChatBody in its "quick" variant, sharing send
/// orchestration and streaming with the detached window's "full" variant.
export function InlineChat({
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
}: InlineChatProps) {
  const confirm = useCloseConfirm(pendingCount, onClose);

  return (
    <div className="inline-chat">
      <div className="inline-chat-shell floating-surface">
        <div className="inline-chat-header">
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
          variant="quick"
          onExpand={onDetach}
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
