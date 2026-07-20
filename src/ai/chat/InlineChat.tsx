import { useRef, useState } from "react";
import type { AgentConversation } from "../useAgentConversation";
import { useViewportClamp } from "../../utils/useViewportClamp";
import type { EditorRunner } from "../../editor/useEditorRunner";
import type { InlineChatInfo } from "../useInlineChat";
import type { PendingStatus } from "../usePendingEdits";
import type { EditProposal } from "../types";
import { ChatBody, type ChatBodyLabels } from "./ChatBody";
import { useAnchoredPosition } from "./useAnchoredPosition";
import "../AgentTurnView.css";
import "./inline-chat.css";

export interface InlineChatLabels extends ChatBodyLabels {
  /** Accessible name / tooltip of the header's close button. */
  close: string;
  /** Accessible name / tooltip of the pop-out button. */
  detach: string;
  /** Close prompt while edits are pending; "{n}" is how many. */
  closeConfirm: string;
  closeConfirmAccept: string;
  closeConfirmReject: string;
  closeConfirmCancel: string;
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
  /** Pops the chat out into its own OS window (see chat-bridge.ts). */
  onDetach: () => void;
  onClose: () => void;
}

/// The EMBEDDED half of the chat's two modes - a cursor-anchored panel,
/// modeled on the inline "Cmd+K" assistant popups in editors like VS Code
/// (Claude Code's inline chat).
///
/// Embedded means placed for you: it opens beside the caret, follows it as
/// the view scrolls, flips to whichever side of the line has room, and stays
/// inside the viewport. It is deliberately NOT draggable or resizable.
/// Wanting to arrange the chat is what the detached window is for, and the
/// platform's own window does that better than any simulation inside a
/// webview - native edges, native title bar, and it can leave the app.
///
/// This file is only the panel's CHROME: placement, the header, and the close
/// confirmation. The chat itself is ChatBody, shared verbatim with the
/// detached window so the two modes can't drift.
///
/// The only way a reply touches the document is a proposal's Accept in the
/// chat card, which renders as a red/green preview first; Cmd+Z undoes it
/// once accepted. There is deliberately no path that writes without a
/// preview, in either mode.
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
  onDetach,
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

  // Closing with edits still awaiting a decision asks first, rather than
  // leaving previews decorated in the document with the surface that
  // explains them gone.
  const [confirmingClose, setConfirmingClose] = useState(false);
  function requestClose() {
    if (pendingCount > 0) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  }

  return (
    <div ref={rootRef} className="inline-chat" style={pos}>
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
              onClick={requestClose}
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
          onEscape={requestClose}
          onRevealPending={onRevealPending}
          footer={
            confirmingClose && (
              <div className="inline-chat-confirm">
                <span className="inline-chat-confirm-message">
                  {labels.closeConfirm.replace("{n}", String(pendingCount))}
                </span>
                <div className="inline-chat-confirm-actions">
                  <button
                    className="inline-chat-action inline-chat-action-primary"
                    onClick={() => {
                      onAcceptAll();
                      onClose();
                    }}
                  >
                    {labels.closeConfirmAccept}
                  </button>
                  <button
                    className="inline-chat-action"
                    onClick={() => {
                      onRejectAll();
                      onClose();
                    }}
                  >
                    {labels.closeConfirmReject}
                  </button>
                  <button
                    className="inline-chat-action"
                    onClick={() => setConfirmingClose(false)}
                  >
                    {labels.closeConfirmCancel}
                  </button>
                </div>
              </div>
            )
          }
        />
      </div>
    </div>
  );
}
