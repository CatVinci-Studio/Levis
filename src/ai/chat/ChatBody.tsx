import { useEffect, useRef, useState } from "react";
import type {
  AgentConversation,
  AgentRequestOptions,
} from "../useAgentConversation";
import type { AgentMode } from "../../settings/SettingsContext";
import type { PendingStatus } from "../usePendingEdits";
import type {
  AgentTurn,
  ChatAttachment,
  EditProposal,
  ImageAttachment,
} from "../types";
import {
  ChatMessages,
  ErrorRow,
  ThinkingIndicator,
  type ChatMessagesLabels,
} from "./ChatMessages";
import { ChatComposer, type ChatComposerLabels } from "./ChatComposer";
import {
  QuickAskPendingBar,
  type QuickAskPendingBarLabels,
} from "./QuickAskPendingBar";
import { parseProposal } from "./proposal";
import { attachedFileBlock, selectedTextBlock } from "./user-message";
import {
  AI_MESSAGE_SENT_EVENT,
  TUTORIAL_AGENT_PROPOSAL_EVENT,
} from "../../utils/events";

export interface ChatBodyLabels
  extends ChatMessagesLabels, ChatComposerLabels, QuickAskPendingBarLabels {
  /** Sent as the user's message when relocating a stale proposal. */
  relocateRequest: string;
  /** Pinned pending-edits bar (full/window variant only); "{n}" is how many
   *  are undecided. */
  pendingSummary: string;
  pendingReveal: string;
  /** The quick variant's "open the full conversation" button. */
  expandConversation: string;
  expandInline: string;
  collapseInline: string;
  approvePlan: string;
  executePlanRequest: string;
}

export interface ChatBodyProps {
  /** Document as markdown source - what the request is sent with. */
  document: string;
  /** Selection as plain text (composer chip) and as markdown (what the model
   *  is actually shown, so formatting survives - see doc-markdown.ts). */
  selectedText: string | null;
  selectionMarkdown: string | null;
  docPath: string | null;
  /** Explicit agent workspace root, or null for the document's own folder. */
  workspaceRoot: string | null;
  conversation: AgentConversation;
  defaultMode: AgentMode;
  defaultWebSearch: boolean;
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
  /** Jumps the editor to a pending edit. Absent in the detached window,
   *  which can't scroll another window's document. */
  onRevealPending?: () => void;
  /** The chat has a fixed height to fill (a resized panel, or a window), so
   *  the message list renders even while empty - it is the flexible region,
   *  and without it the composer would sit at the top of a blank panel. */
  fillHeight?: boolean;
  /** "quick" (the in-document Quick Ask bar) renders NO conversation - just
   *  a one-line reply summary, the pending bar, and the composer. Edits are
   *  the output; reading happens in the detached window ("full", default). */
  variant?: "quick" | "full";
  /** Detached window only: fetches the editor's document and selection as
   *  they read at this instant, immediately before a send.
   *
   *  The window is the cross-file surface, so it must not send against
   *  whatever was last pushed to it - the user may have typed, or moved to
   *  another file, since. Pulling once per send is exact and costs nothing
   *  in between; keeping a pushed copy fresh would mean re-serializing the
   *  whole document on every keystroke. Resolves null if the editor doesn't
   *  answer, in which case the last pushed context is used. */
  refreshContext?: () => Promise<{
    document: string;
    selectionMarkdown: string | null;
  } | null>;
  /** Quick variant only: opens the full conversation (detach to a window). */
  onExpand?: () => void;
  /** Quick variant only: the "review one at a time" nav bar's state/actions
   *  (usePendingEdits' focus* API), as one required-together object -
   *  without it the quick variant renders no pending bar at all, rather
   *  than a bar whose buttons silently do nothing. */
  quickReview?: QuickReview;
}

/** The Quick Ask nav bar's whole contract - see ChatBodyProps.quickReview. */
export interface QuickReview {
  /** 0-based position of the currently focused edit, or -1 if none. */
  focusIndex: number;
  onFocusNext: () => void;
  onFocusPrevious: () => void;
  onAcceptFocused: () => void;
  onRejectFocused: () => void;
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
/** The propose_edit tool calls in `turns`, parsed - what `onProposals`
 *  consumers (usePendingEdits directly, or the detached-window bridge)
 *  expect. Shared by the settled afterSend path and the live streamed-turn
 *  path so the two can't drift. */
function proposalsFromTurns(turns: AgentTurn[]) {
  return turns.flatMap((turn) => {
    if (turn.kind !== "ToolCall" || turn.name !== "propose_edit") return [];
    const proposal = parseProposal(turn.arguments);
    return proposal ? [{ callId: turn.call_id, proposal }] : [];
  });
}

export function ChatBody({
  document,
  selectedText,
  selectionMarkdown,
  docPath,
  workspaceRoot,
  conversation,
  defaultMode,
  defaultWebSearch,
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
  variant = "full",
  refreshContext,
  onExpand,
  onRevealPending,
  quickReview,
}: ChatBodyProps) {
  const {
    history,
    streaming,
    busy,
    error,
    retryable,
    lastMode,
    send,
    stop,
    retry,
  } = conversation;
  const listRef = useRef<HTMLDivElement>(null);
  const [quickExpanded, setQuickExpanded] = useState(false);

  // Streamed turns become pending previews the moment they land, not when
  // the whole exchange resolves - a propose_edit shows up in the document
  // while the agent loop is still running. afterSend re-extracts the same
  // proposals afterwards; showPreviews adds are idempotent per callId, so
  // the second pass is a no-op for anything already shown here.
  const streamedTurnCount = useRef(0);
  useEffect(() => {
    if (!streaming) {
      streamedTurnCount.current = 0;
      return;
    }
    const fresh = streaming.turns.slice(streamedTurnCount.current);
    streamedTurnCount.current = streaming.turns.length;
    const proposals = proposalsFromTurns(fresh);
    if (proposals.length > 0) onProposals(proposals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming?.turns]);

  // Keep the newest streamed content in view while it grows.
  useEffect(() => {
    if (!streaming) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [streaming]);

  function afterSend(newTurns: AgentTurn[] | undefined) {
    const proposals = proposalsFromTurns(newTurns ?? []);
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

  /**
   * Composes a NEW message and sends it - the user's own, and the relocate
   * request, which are the two that have to be written against the document
   * as it reads at send time rather than as it read when this component last
   * rendered. `buildMessage` therefore receives that state: the detached
   * window pulls a fresh copy first (`refreshContext`), while the in-document
   * bar has nothing to pull - its opening snapshot IS the point - and falls
   * back to the props.
   *
   * `handleRetry` deliberately does NOT come through here: a retry resends
   * the failed message verbatim, against the document it was composed for
   * (useAgentConversation's RetryableSend), so re-resolving it would make
   * "retry" mean something else.
   */
  function dispatchSend(
    buildMessage: (state: {
      document: string;
      selectionMarkdown: string | null;
    }) => { message: string; images?: ImageAttachment[] },
    options: AgentRequestOptions,
  ) {
    void (async () => {
      const latest = refreshContext ? await refreshContext() : null;
      const state = latest ?? { document, selectionMarkdown };
      const { message, images } = buildMessage(state);
      afterSend(await send(state.document, message, images, options));
    })();
  }

  function handleSend(
    message: string,
    attachments: ChatAttachment[],
    includeSelection: boolean,
    options: AgentRequestOptions,
  ) {
    // Signals the interactive tutorial's "ask AI something" step - a real
    // send, not just opening the panel.
    if (tutorialMock) window.dispatchEvent(new Event(AI_MESSAGE_SENT_EVENT));
    dispatchSend(({ selectionMarkdown: selection }) => {
      // Rewrites of the selection come back as replace_selection tool calls
      // (see AGENT_TOOL_INSTRUCTIONS in src-tauri/src/ai/agent.rs); the tag
      // carries the selection's MARKDOWN so formatting survives the trip.
      const tagged =
        selection && includeSelection
          ? `${selectedTextBlock(selection)}\n\n${message}`
          : message;
      // Text-shaped attachments were already extracted in Rust (PDF, Word,
      // spreadsheets and plain files all arrive as text) and ride inside the
      // prompt. Images have nothing to extract and go as provider image
      // parts instead - see commands/attachment.rs.
      const attachmentBlocks = attachments
        .filter((f) => f.kind === "text")
        .map((f) => attachedFileBlock(f.name, f.content))
        .join("\n\n");
      return {
        message: attachmentBlocks ? `${attachmentBlocks}\n\n${tagged}` : tagged,
        // Not filtered on vision here: the composer refuses to stage an image
        // for a provider that can't read one, and the backend refuses the
        // whole message if one gets through anyway. Silently dropping it
        // would be a third policy contradicting both.
        images: attachments
          .filter((f) => f.kind === "image")
          .map((f) => ({
            name: f.name,
            mime: f.mime,
            dataBase64: f.dataBase64,
          })),
      };
    }, options);
  }

  /** An anchor that no longer resolves: ask the model to re-issue the edit
   *  against the document as it now reads, rather than writing text whose
   *  target we can't locate. */
  function handleRelocate(proposal: EditProposal) {
    dispatchSend(
      () => ({
        message: labels.relocateRequest.replace("{text}", proposal.text ?? ""),
      }),
      { mode: "edit", webSearch: false },
    );
  }

  function approvePlan() {
    dispatchSend(() => ({ message: labels.executePlanRequest }), {
      mode: "edit",
      webSearch: defaultWebSearch,
    });
  }

  function handleRetry() {
    void (async () => {
      afterSend(await retry());
    })();
  }

  const showMessages = history.length > 0 || busy || !!error || !!fillHeight;

  // The quick variant's one-line reply: live streamed prose while it
  // arrives, else the conversation's last assistant reply (so a restored
  // conversation shows where it left off).
  let summaryText: string | null = null;
  if (variant === "quick") {
    summaryText = streaming?.text || null;
    if (!summaryText) {
      for (let i = history.length - 1; i >= 0; i--) {
        const turn = history[i];
        if (turn.kind === "Assistant") {
          summaryText = turn.text;
          break;
        }
      }
    }
  }

  return (
    <>
      {variant === "quick"
        ? (busy || error || summaryText) && (
            <div
              className={`quick-ask-status${quickExpanded ? " quick-ask-status-expanded" : ""}`}
            >
              {!quickExpanded && error && (
                <ErrorRow
                  error={error}
                  retryLabel={labels.retry}
                  onRetry={retryable ? handleRetry : null}
                />
              )}
              {!quickExpanded && !error && summaryText && (
                <div className="quick-ask-summary-row">
                  <span className="quick-ask-summary">{summaryText}</span>
                </div>
              )}
              {!quickExpanded && !error && busy && !summaryText && (
                <ThinkingIndicator label={labels.thinking} />
              )}
              {quickExpanded && (
                <div className="quick-ask-transcript" ref={listRef}>
                  <ChatMessages
                    history={history}
                    streaming={streaming}
                    busy={busy}
                    error={error}
                    selectedText={selectedText}
                    labels={labels}
                    proposalStatus={proposalStatus}
                    onAcceptProposal={onAcceptProposal}
                    onRejectProposal={onRejectProposal}
                    onRelocateProposal={handleRelocate}
                    canRetry={!!retryable}
                    onRetry={handleRetry}
                  />
                </div>
              )}
              {(summaryText || history.length > 0 || error) && (
                <div className="quick-ask-answer-actions">
                  <button
                    className="inline-chat-action"
                    onClick={() => setQuickExpanded((value) => !value)}
                  >
                    {quickExpanded
                      ? labels.collapseInline
                      : labels.expandInline}
                  </button>
                  {onExpand && (
                    <button
                      className="inline-chat-action quick-ask-expand"
                      onClick={onExpand}
                    >
                      {labels.expandConversation}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        : showMessages && (
            <div className="inline-chat-messages" ref={listRef}>
              <ChatMessages
                history={history}
                streaming={streaming}
                busy={busy}
                error={error}
                selectedText={selectedText}
                labels={labels}
                proposalStatus={proposalStatus}
                onAcceptProposal={onAcceptProposal}
                onRejectProposal={onRejectProposal}
                onRelocateProposal={handleRelocate}
                canRetry={!!retryable}
                onRetry={handleRetry}
              />
            </div>
          )}
      {variant === "quick"
        ? quickReview && (
            <QuickAskPendingBar
              total={pendingCount}
              focusIndex={quickReview.focusIndex}
              onFocusNext={quickReview.onFocusNext}
              onFocusPrevious={quickReview.onFocusPrevious}
              onAcceptFocused={quickReview.onAcceptFocused}
              onRejectFocused={quickReview.onRejectFocused}
              onAcceptAll={onAcceptAll}
              onRejectAll={onRejectAll}
              labels={labels}
            />
          )
        : pendingCount > 0 && (
            <div className="inline-chat-pending-bar">
              <span className="inline-chat-pending-count">
                {labels.pendingSummary.replace("{n}", String(pendingCount))}
              </span>
              <div className="inline-chat-pending-actions">
                {onRevealPending && (
                  <button
                    className="inline-chat-action"
                    onClick={onRevealPending}
                  >
                    {labels.pendingReveal}
                  </button>
                )}
                <button className="inline-chat-action" onClick={onAcceptAll}>
                  {labels.proposalAcceptAll}
                </button>
                <button className="inline-chat-action" onClick={onRejectAll}>
                  {labels.proposalRejectAll}
                </button>
              </div>
            </div>
          )}
      {lastMode === "plan" && !busy && history.length > 0 && (
        <div className="agent-plan-actions">
          <button
            className="inline-chat-action inline-chat-action-primary"
            onClick={approvePlan}
          >
            {labels.approvePlan}
          </button>
        </div>
      )}
      <ChatComposer
        docPath={docPath}
        workspaceRoot={workspaceRoot}
        selectedText={selectedText}
        busy={busy}
        labels={labels}
        defaultMode={defaultMode}
        defaultWebSearch={defaultWebSearch}
        onSend={handleSend}
        onStop={stop}
        onEscape={onEscape ?? (() => {})}
      />
      {footer}
    </>
  );
}
