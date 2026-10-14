import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AgentTurnView, type AgentTurnLabels } from "../AgentTurnView";
import type { AgentTurn, EditAction, EditProposal } from "../types";
import type { PendingStatus } from "../usePendingEdits";
import type { StreamingState } from "../useAgentConversation";
import { parseProposal } from "./proposal";
import { classifyAiError, type AiErrorKind } from "../error-messages";
import { diffLines } from "./line-diff";
import { composeSentences, diffSentences } from "./sentence-diff";
import { FlipOnChange } from "../../ui/flip";

/** An add_comment call's arguments (src-tauri ai/tools.rs). */
function parseComment(
  argumentsJson: string,
): { anchor: string; comment: string; context?: string } | null {
  try {
    const parsed = JSON.parse(argumentsJson);
    if (typeof parsed.anchor !== "string" || typeof parsed.comment !== "string")
      return null;
    return {
      anchor: parsed.anchor,
      comment: parsed.comment,
      context: typeof parsed.context === "string" ? parsed.context : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Partial acceptance of a rewrite: the changed sentences (groups), for the
 * card to offer each with a checkbox. Null when there are fewer than two -
 * one change is just Accept or Reject.
 */
function useSentenceChanges(
  callId: string,
  proposal: EditProposal,
  original: ((callId: string) => string | null) | undefined,
  /** Only a pending proposal has a preview to read the original from. */
  pending: boolean,
) {
  return useMemo(() => {
    if (
      !pending ||
      !original ||
      (proposal.action !== "replace" && proposal.action !== "replace_selection")
    )
      return null;
    const before = original(callId);
    if (before === null || proposal.text === undefined) return null;
    const hunks = diffSentences(before, proposal.text);
    const changes = hunks.filter((h) => h.kind === "change");
    return changes.length < 2 ? null : { hunks, changes };
    // The original is read once the preview is pending (`original` arrives
    // then); it can't change while it stays pending - the preview would be
    // dropped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, proposal, pending]);
}

export interface ChatMessagesLabels extends AgentTurnLabels {
  thinking: string;
  proposalTitle: string;
  proposalStatus: Record<Exclude<PendingStatus, "pending">, string>;
  proposalAccept: string;
  proposalReject: string;
  proposalAcceptAll: string;
  proposalRejectAll: string;
  /** Offered when an anchor no longer resolves - asks the model to re-issue
   *  the proposal against the document as it now reads. */
  proposalRelocate: string;
  /** Tooltips of the "+X −Y" chips that open and close the full diff. */
  diffCollapse: string;
  diffShow: string;
  actionNames: Record<EditAction, string>;
  retry: string;
  /** "Choose sentences ({n})" toggle on a multi-sentence rewrite. */
  proposalPickSentences: string;
  /** The Accept button while only some sentence changes are ticked:
   *  "{k}" of "{n}". */
  proposalAcceptSome: string;
  /** An add_comment card's jump-to-passage button. */
  commentLocate: string;
  /** Plain-language help per kind of provider failure (ErrorRow). */
  aiErrors: Record<AiErrorKind, string>;
}

interface ChatMessagesProps {
  history: AgentTurn[];
  /** Live view of the in-flight exchange (turns landed so far + assistant
   *  prose being generated). Null when idle - and on providers without
   *  streaming, where the reply still arrives all at once via `history`. */
  streaming: StreamingState | null;
  busy: boolean;
  error: string | null;
  selectedText: string | null;
  labels: ChatMessagesLabels;
  proposalStatus: (callId: string) => PendingStatus;
  /** `text`: a partial acceptance - see useSentenceChanges. */
  onAcceptProposal: (callId: string, text?: string) => void;
  /** What a pending rewrite would replace (usePendingEdits.originalText);
   *  absent where the document isn't reachable (the detached window), which
   *  hides the per-sentence picker. */
  proposalOriginal?: (callId: string) => string | null;
  /** Jumps to an add_comment card's passage in the document; absent where
   *  the document isn't reachable (the detached window). */
  onLocateText?: (anchor: string, context?: string) => void;
  onRejectProposal: (callId: string) => void;
  /** Asks the model to re-propose an edit whose anchor went stale. */
  onRelocateProposal: (proposal: EditProposal) => void;
  /** False where another control decides pending edits (Quick Ask's
   *  review bar) - the cards then show what each edit is, without a second
   *  set of Accept/Reject buttons. */
  proposalActions?: boolean;
  /** Set only when `error` came from a failed send whose (document, message)
   *  is still available to resend - not every error is retryable this way. */
  canRetry: boolean;
  onRetry: () => void;
}

/**
 * The turn history: proposal cards, plain turns, and the busy/error states.
 * While a request runs, the streamed turns and the assistant prose being
 * generated render live after the settled history; when the request
 * resolves, the same turns re-enter via `history` at the same list indexes,
 * so React keeps the DOM nodes and nothing flickers or re-animates. Newly
 * arrived turns get a small staggered fade-in on top.
 *
 * The proposal card is the ONLY place an edit is accepted or rejected. The
 * document shows the same edit as red/green marks, but carries no controls of
 * its own - two sets of buttons for one action, on screen simultaneously, is
 * what this replaced.
 */
export function ChatMessages({
  history,
  streaming,
  busy,
  error,
  selectedText,
  labels,
  proposalStatus,
  onAcceptProposal,
  onRejectProposal,
  onRelocateProposal,
  proposalActions = true,
  proposalOriginal,
  onLocateText,
  canRetry,
  onRetry,
}: ChatMessagesProps) {
  const revealFrom = useRef(0);
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (busy && !wasBusy.current) revealFrom.current = history.length;
    wasBusy.current = busy;
  }, [busy, history.length]);

  // Memoized on the turn lists, NOT on `streaming` itself: text deltas
  // replace the streaming object many times a second while reusing the
  // same turns array, and none of this depends on the text.
  const streamingTurns = streaming?.turns;
  const shown = useMemo(
    () => (streamingTurns ? [...history, ...streamingTurns] : history),
    [history, streamingTurns],
  );

  // propose_edit calls render as proposal cards (parsed here once per
  // turn-list change, NOT per render - streaming deltas re-render this
  // component many times a second and JSON.parse of a full edit per card
  // per delta added up); their paired tool results are backend->model
  // bookkeeping and would only add noise.
  // Filled while rendering: a comment's tool result renders nothing (the
  // card is the result), and it always follows its call in the list.
  const commentIds = new Set<string>();
  const parsedProposals = useMemo(() => {
    const map = new Map<string, EditProposal | null>();
    for (const turn of shown)
      if (turn.kind === "ToolCall" && turn.name === "propose_edit")
        map.set(turn.call_id, parseProposal(turn.arguments));
    return map;
  }, [shown]);

  // A decided card shrinks to its status line; whatever is under it moves
  // up to meet it rather than jumping (FlipOnChange).
  const decisions = shown
    .map((turn) =>
      turn.kind === "ToolCall" && turn.name === "propose_edit"
        ? proposalStatus(turn.call_id)
        : "",
    )
    .join(" ");

  return (
    <>
      <FlipOnChange
        watch={decisions}
        targets={() =>
          document.querySelectorAll(
            ":is(.inline-chat-messages, .quick-ask-transcript) > *",
          )
        }
      />
      {shown.map((turn, i) => {
        const reveal = i >= revealFrom.current;
        // A CSS custom property, not a standard style key - CSSProperties
        // doesn't type these, hence the cast. The stagger stops at the
        // third turn: a long reply should not take a second to show.
        const style: CSSProperties | undefined = reveal
          ? ({
              "--reveal-delay": `${Math.min(i - revealFrom.current, 3) * 40}ms`,
            } as CSSProperties)
          : undefined;
        if (turn.kind === "ToolCall" && turn.name === "propose_edit") {
          const proposal = parsedProposals.get(turn.call_id);
          if (!proposal)
            return <AgentTurnView key={i} turn={turn} labels={labels} />;
          const known = proposalStatus(turn.call_id);
          // While a request runs, a card can render a beat before its
          // preview is registered (or, in the detached window, before the
          // editor's status push arrives) - that's still arriving, not
          // expired.
          const status = known === "expired" && busy ? "streaming" : known;
          return (
            <ProposalCard
              key={i}
              callId={turn.call_id}
              proposal={proposal}
              status={status}
              reveal={reveal}
              style={style}
              selectedText={selectedText}
              labels={labels}
              original={proposalOriginal}
              onAccept={onAcceptProposal}
              onReject={onRejectProposal}
              onRelocate={onRelocateProposal}
              actions={proposalActions}
            />
          );
        }
        if (turn.kind === "ToolCall" && turn.name === "add_comment") {
          const comment = parseComment(turn.arguments);
          if (comment) {
            commentIds.add(turn.call_id);
            return (
              <div
                key={i}
                className={`agent-comment${reveal ? " turn-reveal" : ""}`}
                style={style}
              >
                <blockquote className="agent-comment-quote">
                  {comment.anchor}
                </blockquote>
                <div className="agent-comment-text">{comment.comment}</div>
                {onLocateText && (
                  <button
                    type="button"
                    className="inline-chat-action"
                    onClick={() =>
                      onLocateText(comment.anchor, comment.context)
                    }
                  >
                    {labels.commentLocate}
                  </button>
                )}
              </div>
            );
          }
        }
        if (
          turn.kind === "ToolResult" &&
          (parsedProposals.has(turn.call_id) || commentIds.has(turn.call_id))
        )
          return null;
        return (
          <div
            key={i}
            className={reveal ? "turn-reveal" : undefined}
            style={style}
          >
            <AgentTurnView turn={turn} labels={labels} />
          </div>
        );
      })}
      {streaming && streaming.text.length > 0 && (
        <div className="turn-reveal agent-streaming">
          <AgentTurnView
            turn={{ kind: "Assistant", text: streaming.text }}
            labels={labels}
          />
        </div>
      )}
      {busy && !streaming?.text && (
        <ThinkingIndicator label={labels.thinking} />
      )}
      {error && (
        <ErrorRow
          error={error}
          retryLabel={labels.retry}
          onRetry={canRetry ? onRetry : null}
          explanations={labels.aiErrors}
        />
      )}
    </>
  );
}

/** The three-dot "thinking" row. Shared with ChatBody's quick variant so the
 *  two chat surfaces can't drift on this markup. */
export function ThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="agent-thinking">
      <span className="agent-thinking-label">{label}</span>
      <span className="agent-thinking-dots">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

/** The error row, with a retry button when the failed send is resendable
 *  (`onRetry` null otherwise). Shared with ChatBody's quick variant. */
export function ErrorRow({
  error,
  retryLabel,
  onRetry,
  explanations,
}: {
  error: string;
  retryLabel: string;
  onRetry: (() => void) | null;
  /** What to do, per recognized kind of failure (error-messages.ts). */
  explanations?: Partial<Record<AiErrorKind, string>>;
}) {
  const kind = classifyAiError(error);
  const explanation = kind ? explanations?.[kind] : undefined;
  return (
    <div className="agent-error">
      {explanation && (
        <div className="agent-error-explanation">{explanation}</div>
      )}
      <div className={explanation ? "agent-error-detail" : undefined}>
        {error}
      </div>
      {onRetry && (
        <button
          className="inline-chat-action agent-error-retry"
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/**
 * One propose_edit call: a header with what kind of edit it is and its
 * "+X −Y" size, the model's reason, and one row of controls.
 *
 * The full line diff stays collapsed behind the size chips - the document
 * already paints the change as red/green marks. The one state that opens
 * it is `invalid`: an anchor that couldn't be located leaves NO
 * in-document preview, so the card is then the only view of the content.
 *
 * A rewrite of several sentences can be taken in part: "Choose sentences"
 * lists the changes with checkboxes, and the same Accept button then
 * applies only the ticked ones ("Accept 1 of 2") - one accept button, not
 * a second one for the partial case.
 */
function ProposalCard({
  callId,
  proposal,
  status,
  reveal,
  style,
  selectedText,
  labels,
  original,
  onAccept,
  onReject,
  onRelocate,
  actions = true,
}: {
  callId: string;
  proposal: EditProposal;
  status: PendingStatus;
  reveal: boolean;
  style: CSSProperties | undefined;
  selectedText: string | null;
  labels: ChatMessagesLabels;
  original?: (callId: string) => string | null;
  onAccept: (callId: string, text?: string) => void;
  onReject: (callId: string) => void;
  onRelocate: (proposal: EditProposal) => void;
  actions?: boolean;
}) {
  const [diffOpen, setDiffOpen] = useState(status === "invalid");
  // A proposal that turns invalid after mounting (its preview resolved and
  // failed) must pop open - the card just became the only view of it.
  useEffect(() => {
    if (status === "invalid") setDiffOpen(true);
  }, [status]);

  // `append` has nothing to compare against; the others diff the text they
  // target against the replacement. replace_selection targets the captured
  // selection rather than a quoted anchor.
  const before =
    proposal.action === "append"
      ? ""
      : proposal.action === "replace_selection"
        ? (selectedText ?? "")
        : (proposal.anchor ?? "");
  const after =
    proposal.action === "delete"
      ? ""
      : proposal.action === "insert_before"
        ? `${proposal.text ?? ""}\n${before}`
        : proposal.action === "insert_after"
          ? `${before}\n${proposal.text ?? ""}`
          : (proposal.text ?? "");
  // Memoized because this re-renders on every streaming delta while a later
  // turn is still arriving, and the LCS diff is up to 400x400 lines.
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const added = lines.filter((line) => line.kind === "add").length;
  const removed = lines.filter((line) => line.kind === "remove").length;

  const sentences = useSentenceChanges(
    callId,
    proposal,
    original,
    status === "pending",
  );
  const [picking, setPicking] = useState(false);
  const [take, setTake] = useState<boolean[]>([]);
  const chosen = sentences?.changes.map((_, k) => take[k] ?? true) ?? [];
  const chosenCount = chosen.filter(Boolean).length;
  const partial = picking && !!sentences && chosenCount < chosen.length;

  return (
    <div
      className={`agent-proposal${reveal ? " turn-reveal" : ""}`}
      data-status={status}
      style={style}
    >
      <div className="agent-proposal-head">
        <span className="agent-proposal-title">
          {labels.proposalTitle} · {labels.actionNames[proposal.action]}
        </span>
        <button
          type="button"
          className="agent-diff-summary"
          aria-expanded={diffOpen}
          title={diffOpen ? labels.diffCollapse : labels.diffShow}
          onClick={() => setDiffOpen(!diffOpen)}
        >
          {added > 0 && (
            <span className="agent-diff-chip agent-diff-add">+{added}</span>
          )}
          {removed > 0 && (
            <span className="agent-diff-chip agent-diff-remove">
              {"\u2212"}
              {removed}
            </span>
          )}
          <span className="agent-diff-caret" aria-hidden="true" />
        </button>
      </div>
      {proposal.reason && (
        <div className="agent-proposal-reason">{proposal.reason}</div>
      )}
      {diffOpen && (
        <div className="agent-proposal-diff">
          {lines.map((line, i) => (
            <div key={i} className={`agent-diff-line agent-diff-${line.kind}`}>
              <span className="agent-diff-marker" aria-hidden="true">
                {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
              </span>
              <span className="agent-diff-text">{line.text || "\u00a0"}</span>
            </div>
          ))}
        </div>
      )}
      {picking && sentences && (
        <ul className="agent-proposal-picker-list">
          {sentences.changes.map((hunk, k) => (
            <li key={k}>
              <label>
                <input
                  type="checkbox"
                  className="ui-check"
                  checked={chosen[k]}
                  onChange={(e) => {
                    const next = [...chosen];
                    next[k] = e.target.checked;
                    setTake(next);
                  }}
                />
                <span>
                  {hunk.before.trim() && (
                    <del className="agent-proposal-picker-before">
                      {hunk.before.trim()}
                    </del>
                  )}
                  {hunk.after.trim() && (
                    <ins className="agent-proposal-picker-after">
                      {hunk.after.trim()}
                    </ins>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {status === "pending" ? (
        actions && (
          <div className="agent-proposal-actions">
            <button
              className="inline-chat-action inline-chat-action-primary"
              disabled={partial && chosenCount === 0}
              onClick={() =>
                partial && sentences
                  ? onAccept(callId, composeSentences(sentences.hunks, chosen))
                  : onAccept(callId)
              }
            >
              {partial
                ? labels.proposalAcceptSome
                    .replace("{k}", String(chosenCount))
                    .replace("{n}", String(chosen.length))
                : labels.proposalAccept}
            </button>
            <button
              className="inline-chat-action"
              onClick={() => onReject(callId)}
            >
              {labels.proposalReject}
            </button>
            {sentences && (
              <button
                type="button"
                className="agent-proposal-link agent-proposal-picker-toggle"
                aria-expanded={picking}
                onClick={() => setPicking(!picking)}
              >
                {labels.proposalPickSentences.replace(
                  "{n}",
                  String(sentences.changes.length),
                )}
              </button>
            )}
          </div>
        )
      ) : status === "invalid" ? (
        // The anchor no longer resolves to exactly one place, so there's
        // nothing to preview and nothing safe to write. The only honest move
        // is to ask the model again against the document as it now reads -
        // applying this text blind is what the old direct-apply fallback
        // did, and it could land an edit somewhere the user never saw
        // highlighted.
        <>
          <div className="agent-proposal-status agent-proposal-status-invalid">
            {labels.proposalStatus.invalid}
          </div>
          <button
            className="inline-chat-action"
            onClick={() => onRelocate(proposal)}
          >
            {labels.proposalRelocate}
          </button>
        </>
      ) : (
        <div
          className={`agent-proposal-status agent-proposal-status-${status}`}
        >
          {labels.proposalStatus[status]}
        </div>
      )}
    </div>
  );
}
