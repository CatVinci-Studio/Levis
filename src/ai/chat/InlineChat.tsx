import { useRef, useState } from "react";
import type { AgentConversation } from "../useAgentConversation";
import { useCloseOnOutsideClick } from "../../utils/useCloseOnOutsideClick";
import { useViewportClamp } from "../../utils/useViewportClamp";
import type { InlineChatInfo } from "../useInlineChat";
import type { PendingStatus } from "../usePendingEdits";
import type {
  AgentTurn,
  ChatAttachment,
  EditAction,
  EditProposal,
} from "../types";
import { ChatMessages } from "./ChatMessages";
import { ChatComposer } from "./ChatComposer";
import { parseProposal } from "./proposal";
import {
  AI_MESSAGE_SENT_EVENT,
  TUTORIAL_AGENT_PROPOSAL_EVENT,
} from "../../utils/events";
import "../AgentTurnView.css";
import "./inline-chat.css";

export interface InlineChatLabels {
  placeholder: string;
  send: string;
  stop: string;
  thinking: string;
  attachFile: string;
  selectedChars: string;
  proposalTitle: string;
  proposalApply: string;
  proposalStatus: Record<Exclude<PendingStatus, "pending">, string>;
  proposalAccept: string;
  proposalReject: string;
  actionNames: Record<EditAction, string>;
  retry: string;
}

interface InlineChatProps {
  x: number;
  y: number;
  document: string;
  selectedText: string | null;
  /** The document's path - resolves the agent workspace (skills, files). */
  docPath: string | null;
  /** The full context captured when the bar opened - handed back verbatim
   *  with any propose_edit calls a reply produces (onProposals) so the
   *  in-document preview resolves against request-time context even if the
   *  bar has since closed or reopened elsewhere by the time the reply
   *  arrives. */
  chatInfo: InlineChatInfo;
  /** Conversation state owned by the editor so it can be saved after close;
   *  a normal subsequent open resets it, while sidebar history restores it. */
  conversation: AgentConversation;
  /** This chat is the onboarding tour's mock conversation - the only one
   *  whose sends/proposals may advance the tour, so the tour's global
   *  window events are dispatched only when this is set. */
  tutorialMock?: boolean;
  labels: InlineChatLabels;
  /** Fallback for a proposal whose anchor couldn't be resolved into a live
   *  preview (status "invalid") - applies it directly, same error contract
   *  as onApply. */
  onApplyProposal: (proposal: EditProposal) => string | null;
  /** A reply produced one or more propose_edit tool calls - hand them to
   *  usePendingEdits.showPreviews so they render as in-document previews. */
  onProposals: (
    proposals: { callId: string; proposal: EditProposal }[],
    chatInfo: InlineChatInfo,
  ) => void;
  /** Live status of a propose_edit call_id, from usePendingEdits.status. */
  proposalStatus: (callId: string) => PendingStatus;
  onAcceptProposal: (callId: string) => void;
  onRejectProposal: (callId: string) => void;
  onClose: () => void;
}

/// A cursor-anchored inline assistant bar - invoked via shortcut or the
/// context menu, styled after VS Code's inline Claude Code chat: a floating
/// popup, not a persistent panel. If text was selected at invocation time
/// it's silently attached to the outgoing message wrapped in a
/// <selected-text> tag. The only way a reply touches the document is a
/// propose_edit proposal's Accept - it renders as a red/green preview right
/// in the document, and history (Cmd+Z) undoes an accepted edit; free-text
/// replies are commentary only, nothing to click. No title bar, no history
/// or new-chat controls of its own - it's just the turn list and the input;
/// browsing/restoring a past conversation lives in the sidebar's Chats tab
/// (RESTORE_CHAT_EVENT, handled in MilkdownEditor). Every ordinary popup open
/// starts a new conversation; sidebar history is the explicit resume path.
///
/// Split across chat/ by responsibility: this file is the shell (position,
/// outside-click close, orchestrating a send); ChatMessages owns the turn
/// list and proposal cards; ChatComposer owns the input row and skill
/// picker.
export function InlineChat({
  x,
  y,
  document,
  selectedText,
  docPath,
  chatInfo,
  conversation,
  tutorialMock,
  labels,
  onApplyProposal,
  onProposals,
  proposalStatus,
  onAcceptProposal,
  onRejectProposal,
  onClose,
}: InlineChatProps) {
  const [applyError, setApplyError] = useState<string | null>(null);
  const { history, busy, error, retryable, send, stop, retry } = conversation;

  const rootRef = useCloseOnOutsideClick<HTMLDivElement>(onClose);
  const listRef = useRef<HTMLDivElement>(null);
  // grow "up": the composer's screen position stays put and the history
  // above it grows upward, instead of the whole popup growing downward from
  // the cursor and dragging the input away as the conversation lengthens.
  const pos = useViewportClamp(rootRef, x, y, { grow: "up" });

  function applyInvalidProposal(proposal: EditProposal) {
    const err = onApplyProposal(proposal);
    setApplyError(err);
  }

  // Shared tail of both a fresh send and a retry: turn propose_edit calls
  // into in-document previews and scroll the new turns into view.
  function afterSend(
    newTurns: AgentTurn[] | undefined,
    requestChatInfo: InlineChatInfo,
  ) {
    const proposals = (newTurns ?? []).flatMap((turn) => {
      if (turn.kind !== "ToolCall" || turn.name !== "propose_edit") return [];
      const proposal = parseProposal(turn.arguments);
      return proposal ? [{ callId: turn.call_id, proposal }] : [];
    });
    if (proposals.length > 0) {
      onProposals(proposals, requestChatInfo);
      if (tutorialMock)
        window.dispatchEvent(new Event(TUTORIAL_AGENT_PROPOSAL_EVENT));
    }
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }

  function handleSend(message: string, attachments: ChatAttachment[]) {
    setApplyError(null);
    // Signals the interactive tutorial's "ask AI something" step - a real
    // send, not just opening the panel. Only the tour's own mock chat may
    // advance the lesson; chats in other tabs stay out of it.
    if (tutorialMock) window.dispatchEvent(new Event(AI_MESSAGE_SENT_EVENT));
    // Rewrites of the selection come back as replace_selection tool calls
    // (see AGENT_TOOL_INSTRUCTIONS in src-tauri/src/ai/agent.rs) - the tag
    // here just carries the selection as context.
    const tagged = selectedText
      ? `<selected-text>\n${selectedText}\n</selected-text>\n\n${message}`
      : message;
    // Attachments ride inside this one message, ahead of the request text.
    const attachmentBlocks = attachments
      .map(
        (f) =>
          `<attached-file name="${f.name}">\n${f.content}\n</attached-file>`,
      )
      .join("\n\n");
    // Snapshot chatInfo now (request time), not read from props later - the
    // bar (or a differently-anchored reopening of it) may not still reflect
    // this request's context by the time the reply arrives.
    const requestChatInfo = chatInfo;
    void (async () => {
      const newTurns = await send(
        document,
        attachmentBlocks ? `${attachmentBlocks}\n\n${tagged}` : tagged,
      );
      afterSend(newTurns, requestChatInfo);
    })();
  }

  function handleRetry() {
    setApplyError(null);
    const requestChatInfo = chatInfo;
    void (async () => {
      const newTurns = await retry();
      afterSend(newTurns, requestChatInfo);
    })();
  }

  // The message list only shows once this conversation actually has
  // content - a freshly opened bar doesn't pop up an empty-looking card
  // above the input just because it exists.
  const showMessages = history.length > 0 || busy || !!error;

  return (
    <div ref={rootRef} className="inline-chat" style={pos}>
      <div className="inline-chat-shell floating-surface">
        {showMessages && (
          <div className="inline-chat-messages" ref={listRef}>
            <ChatMessages
              history={history}
              busy={busy}
              error={error}
              applyError={applyError}
              selectedText={selectedText}
              labels={labels}
              proposalStatus={proposalStatus}
              onAcceptProposal={onAcceptProposal}
              onRejectProposal={onRejectProposal}
              onApplyInvalidProposal={applyInvalidProposal}
              canRetry={!!retryable}
              onRetry={handleRetry}
            />
          </div>
        )}
        <ChatComposer
          docPath={docPath}
          selectedText={selectedText}
          busy={busy}
          labels={labels}
          onSend={handleSend}
          onStop={stop}
          onEscape={onClose}
        />
      </div>
    </div>
  );
}
