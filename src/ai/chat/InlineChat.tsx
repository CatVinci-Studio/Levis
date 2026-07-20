import { useRef } from "react";
import type { AgentConversation } from "../useAgentConversation";
import { useCloseOnOutsideClick } from "../../utils/useCloseOnOutsideClick";
import { useViewportClamp } from "../../utils/useViewportClamp";
import type { EditorRunner } from "../../editor/useEditorRunner";
import type { InlineChatInfo } from "../useInlineChat";
import type { PendingStatus } from "../usePendingEdits";
import type { AgentTurn, ChatAttachment, EditProposal } from "../types";
import { ChatMessages, type ChatMessagesLabels } from "./ChatMessages";
import { ChatComposer, type ChatComposerLabels } from "./ChatComposer";
import { parseProposal } from "./proposal";
import { useAnchoredPosition } from "./useAnchoredPosition";
import {
  AI_MESSAGE_SENT_EVENT,
  TUTORIAL_AGENT_PROPOSAL_EVENT,
} from "../../utils/events";
import "../AgentTurnView.css";
import "./inline-chat.css";

export interface InlineChatLabels
  extends ChatMessagesLabels, ChatComposerLabels {
  /** Sent as the user's message when relocating a stale proposal. */
  relocateRequest: string;
}

interface InlineChatProps {
  /** Drives the popup's position: it follows the document position it was
   *  opened on instead of staying at the coordinates captured then. */
  run: EditorRunner;
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
  onAcceptAll: () => void;
  onRejectAll: () => void;
  pendingCount: number;
  onClose: () => void;
}

/// A cursor-anchored inline assistant bar - invoked via shortcut or the
/// context menu, styled after VS Code's inline Claude Code chat: a floating
/// popup, not a persistent panel. If text was selected at invocation time
/// its MARKDOWN is silently attached to the outgoing message wrapped in a
/// <selected-text> tag (markdown, not flattened text, so the model can see -
/// and preserve - the formatting it is being asked to rewrite; see
/// doc-markdown.ts). No title bar, no history or new-chat controls of its own
/// - it's just the turn list and the input; browsing/restoring a past
/// conversation lives in the sidebar's Chats tab (RESTORE_CHAT_EVENT, handled
/// in MilkdownEditor). Every ordinary popup open starts a new conversation;
/// sidebar history is the explicit resume path.
///
/// The only way a reply touches the document is a proposal's Accept in the
/// chat card. It renders as a red/green preview in the document and history
/// (Cmd+Z) undoes it once accepted; free-text replies are commentary only.
/// There is deliberately no second path that writes without a preview.
///
/// Split across chat/ by responsibility: this file is the shell (position,
/// outside-click close, orchestrating a send); ChatMessages owns the turn
/// list and proposal cards; ChatComposer owns the input row and skill
/// picker.
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
  onClose,
}: InlineChatProps) {
  const { history, busy, error, retryable, send, stop, retry } = conversation;

  const rootRef = useCloseOnOutsideClick<HTMLDivElement>(onClose);
  const listRef = useRef<HTMLDivElement>(null);
  // Follows the document position the chat was opened on, so scrolling
  // doesn't leave the popup stranded over unrelated text.
  const anchor = useAnchoredPosition(run, chatInfo.anchorPos);
  // grow "up": the composer's screen position stays put and the history
  // above it grows upward, instead of the whole popup growing downward from
  // the cursor and dragging the input away as the conversation lengthens.
  const pos = useViewportClamp(
    rootRef,
    anchor?.x ?? chatInfo.x,
    anchor?.y ?? chatInfo.y,
    { grow: "up" },
  );

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

  /** Sends `message` with this request's context snapshotted now (request
   *  time), not read from props later - the bar (or a differently-anchored
   *  reopening of it) may not still reflect this request's context by the
   *  time the reply arrives. */
  function dispatchSend(message: string) {
    const requestChatInfo = chatInfo;
    void (async () => {
      const newTurns = await send(document, message);
      afterSend(newTurns, requestChatInfo);
    })();
  }

  function handleSend(message: string, attachments: ChatAttachment[]) {
    // Signals the interactive tutorial's "ask AI something" step - a real
    // send, not just opening the panel. Only the tour's own mock chat may
    // advance the lesson; chats in other tabs stay out of it.
    if (tutorialMock) window.dispatchEvent(new Event(AI_MESSAGE_SENT_EVENT));
    // Rewrites of the selection come back as replace_selection tool calls
    // (see AGENT_TOOL_INSTRUCTIONS in src-tauri/src/ai/agent.rs) - the tag
    // here just carries the selection as context. It's the selection's
    // MARKDOWN, so formatting survives the round trip.
    const tagged = chatInfo.selectionMarkdown
      ? `<selected-text>\n${chatInfo.selectionMarkdown}\n</selected-text>\n\n${message}`
      : message;
    // Attachments ride inside this one message, ahead of the request text.
    const attachmentBlocks = attachments
      .map(
        (f) =>
          `<attached-file name="${f.name}">\n${f.content}\n</attached-file>`,
      )
      .join("\n\n");
    dispatchSend(
      attachmentBlocks ? `${attachmentBlocks}\n\n${tagged}` : tagged,
    );
  }

  /** An anchor that no longer resolves: ask the model to re-issue the edit
   *  against the document as it now reads, rather than writing text whose
   *  target we can't locate. */
  function handleRelocate(proposal: EditProposal) {
    dispatchSend(labels.relocateRequest.replace("{text}", proposal.text ?? ""));
  }

  function handleRetry() {
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
              selectedText={selectedText}
              labels={labels}
              proposalStatus={proposalStatus}
              onAcceptProposal={onAcceptProposal}
              onRejectProposal={onRejectProposal}
              onAcceptAll={onAcceptAll}
              onRejectAll={onRejectAll}
              pendingCount={pendingCount}
              onRelocateProposal={handleRelocate}
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
