import { useRef } from "react";
import type { AgentConversation } from "../useAgentConversation";
import { useViewportClamp } from "../../utils/useViewportClamp";
import type { EditorRunner } from "../../editor/useEditorRunner";
import type { InlineChatInfo } from "../useInlineChat";
import type { PendingStatus } from "../usePendingEdits";
import type { EditProposal } from "../types";
import { ChatBody, type ChatBodyLabels } from "./ChatBody";
import {
  CloseConfirmBar,
  useCloseConfirm,
  type CloseConfirmLabels,
} from "./CloseConfirm";
import { useAnchoredPosition } from "./useAnchoredPosition";
import "../AgentTurnView.css";
import "./inline-chat.css";

export interface InlineChatLabels extends ChatBodyLabels, CloseConfirmLabels {
  /** Accessible name / tooltip of the header's close button. */
  close: string;
  /** Accessible name / tooltip of the pop-out button. */
  detach: string;
  /** Accessible name / tooltip of Quick Ask's expand-to-sidebar button. */
  openSidebar: string;
  /** The docked sidebar's header title. */
  sidebarTitle: string;
}

interface InlineChatProps {
  /** Drives the popup's position: it follows the document position it was
   *  opened on instead of staying at the coordinates captured then. */
  run: EditorRunner;
  document: string;
  selectedText: string | null;
  /** The document's path - resolves the agent workspace (skills, files). */
  docPath: string | null;
  /** The full context captured when the bar opened. */
  chatInfo: InlineChatInfo;
  /** Conversation state owned by the editor so it can be saved after close;
   *  a normal subsequent open resets it, while sidebar history restores it. */
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
  /** Expands this same conversation into the docked sidebar - the explicit,
   *  user-initiated escalation path; nothing moves there on its own. */
  onOpenSidebar: () => void;
  onClose: () => void;
}

/// QUICK ASK - the lightest of the chat's three surfaces (this popup, the
/// docked sidebar, the detached window), modeled on the inline "Cmd+K"
/// assistant popups in editors like VS Code.
///
/// It opens beside the caret as little more than an input bar; replies show
/// compactly right here (only the latest exchange, tightly capped) so
/// nothing jumps elsewhere on its own, and edit proposals land in the
/// document as previews as always. Wanting the full conversation is an
/// explicit step: the header's expand button opens the SAME conversation in
/// the docked sidebar - two renderings of one state, so the switch is
/// seamless.
///
/// Placement is automatic: it follows the caret, flips to whichever side of
/// the line has room, and stays inside the viewport. Deliberately NOT
/// draggable or resizable - arranging the chat is what the sidebar and the
/// detached window are for.
///
/// This file is only the popup's CHROME: placement, the header, and the
/// close confirmation. The chat itself is ChatBody, shared verbatim with
/// the sidebar and the detached window so the surfaces can't drift.
export function InlineChat({
  run,
  document,
  selectedText,
  docPath,
  chatInfo,
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
  onOpenSidebar,
  onClose,
}: InlineChatProps) {
  // Deliberately NOT closed by clicking outside: the panel is a working
  // surface the user reads next to the document, and an outside click is
  // usually them going to look at that document. Closing is explicit.
  const rootRef = useRef<HTMLDivElement>(null);
  // Placement is entirely automatic in this mode - it follows the document
  // position the chat was opened on, picks the side of the line with room,
  // and stays inside the viewport. There is no dragging or resizing here: a
  // panel the user has to arrange is what the detached WINDOW is for, and
  // the platform does that job better than a simulation of it would.
  const anchor = useAnchoredPosition(run, chatInfo.anchorPos);
  // grow "up" when placed above the line: the composer's screen position
  // stays put and the history grows away from the text, instead of the panel
  // growing over the document as the conversation lengthens.
  const pos = useViewportClamp(
    rootRef,
    anchor?.x ?? chatInfo.x,
    anchor?.y ?? chatInfo.y,
    { grow: anchor?.side === "above" ? "up" : "down" },
  );

  const confirm = useCloseConfirm(pendingCount, onClose);

  return (
    <div ref={rootRef} className="inline-chat" style={pos}>
      <div className="inline-chat-shell floating-surface">
        <div className="inline-chat-header">
          <div className="inline-chat-header-actions">
            <button
              type="button"
              className="inline-chat-header-button"
              aria-label={labels.openSidebar}
              title={labels.openSidebar}
              onClick={onOpenSidebar}
            >
              ⇥
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
          selectionMarkdown={chatInfo.selectionMarkdown}
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
          compact
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
