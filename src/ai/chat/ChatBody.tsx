import { useRef } from "react";
import type { AgentConversation } from "../useAgentConversation";
import type { PendingStatus } from "../usePendingEdits";
import type { AgentTurn, ChatAttachment, EditProposal } from "../types";
import { ChatMessages, type ChatMessagesLabels } from "./ChatMessages";
import { ChatComposer, type ChatComposerLabels } from "./ChatComposer";
import { parseProposal } from "./proposal";
import {
  AI_MESSAGE_SENT_EVENT,
  TUTORIAL_AGENT_PROPOSAL_EVENT,
} from "../../utils/events";

export interface ChatBodyLabels extends ChatMessagesLabels, ChatComposerLabels {
  /** Sent as the user's message when relocating a stale proposal. */
  relocateRequest: string;
}

export interface ChatBodyProps {
  /** Document as markdown source - what the request is sent with. */
  document: string;
  /** Selection as plain text (composer chip) and as markdown (what the model
   *  is actually shown, so formatting survives - see doc-markdown.ts). */
  selectedText: string | null;
  selectionMarkdown: string | null;
  docPath: string | null;
  conversation: AgentConversation;
  tutorialMock?: boolean;
  labels: ChatBodyLabels;
  proposalStatus: (callId: string) => PendingStatus;
  pendingCount: number;
  onProposals: (
    proposals: { callId: string; proposal: EditProposal }[],
  ) => void;
  onAcceptProposal: (callId: string) => void;
  onRejectProposal: (callId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  /** Escape from the composer. The popup closes; a detached window doesn't
   *  (Escape shouldn't destroy an OS window the user placed deliberately). */
  onEscape?: () => void;
  /** Rendered above the composer - the popup's close-confirmation bar. */
  footer?: React.ReactNode;
  /** The chat has a fixed height to fill (a resized panel, or a window), so
   *  the message list renders even while empty - it is the flexible region,
   *  and without it the composer would sit at the top of a blank panel. */
  fillHeight?: boolean;
}

/**
 * The chat itself: turn list, proposal cards, composer, and the send
 * orchestration around them - everything that is the same whether the chat is
 * an embedded popup or its own window.
 *
 * It deliberately owns no document state and applies nothing. Proposals go
 * out through `onProposals` and accept/reject go out through their callbacks,
 * so the embedded case can call usePendingEdits directly while the detached
 * case forwards the identical calls to the editor window over the bridge.
 * Neither path has its own copy of the apply logic.
 */
export function ChatBody({
  document,
  selectedText,
  selectionMarkdown,
  docPath,
  conversation,
  tutorialMock,
  labels,
  proposalStatus,
  pendingCount,
  onProposals,
  onAcceptProposal,
  onRejectProposal,
  onAcceptAll,
  onRejectAll,
  onEscape,
  footer,
  fillHeight,
}: ChatBodyProps) {
  const { history, busy, error, retryable, send, stop, retry } = conversation;
  const listRef = useRef<HTMLDivElement>(null);

  function afterSend(newTurns: AgentTurn[] | undefined) {
    const proposals = (newTurns ?? []).flatMap((turn) => {
      if (turn.kind !== "ToolCall" || turn.name !== "propose_edit") return [];
      const proposal = parseProposal(turn.arguments);
      return proposal ? [{ callId: turn.call_id, proposal }] : [];
    });
    if (proposals.length > 0) {
      onProposals(proposals);
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

  function dispatchSend(message: string) {
    void (async () => {
      afterSend(await send(document, message));
    })();
  }

  function handleSend(message: string, attachments: ChatAttachment[]) {
    // Signals the interactive tutorial's "ask AI something" step - a real
    // send, not just opening the panel.
    if (tutorialMock) window.dispatchEvent(new Event(AI_MESSAGE_SENT_EVENT));
    // Rewrites of the selection come back as replace_selection tool calls
    // (see AGENT_TOOL_INSTRUCTIONS in src-tauri/src/ai/agent.rs); the tag
    // carries the selection's MARKDOWN so formatting survives the round trip.
    const tagged = selectionMarkdown
      ? `<selected-text>\n${selectionMarkdown}\n</selected-text>\n\n${message}`
      : message;
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
    void (async () => {
      afterSend(await retry());
    })();
  }

  const showMessages = history.length > 0 || busy || !!error || !!fillHeight;

  return (
    <>
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
        onEscape={onEscape ?? (() => {})}
      />
      {footer}
    </>
  );
}
