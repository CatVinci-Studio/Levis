import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AgentTurnView, type AgentTurnLabels } from "../AgentTurnView";
import type { AgentTurn, EditAction, EditProposal } from "../types";
import type { PendingStatus } from "../usePendingEdits";
import type { StreamingState } from "../useAgentConversation";
import { parseProposal } from "./proposal";
import { diffLines, isLongDiff } from "./line-diff";

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
  /** Diff expander; "{n}" is how many lines stay hidden. */
  diffExpand: string;
  diffCollapse: string;
  actionNames: Record<EditAction, string>;
  retry: string;
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
  onAcceptProposal: (callId: string) => void;
  onRejectProposal: (callId: string) => void;
  /** Asks the model to re-propose an edit whose anchor went stale. */
  onRelocateProposal: (proposal: EditProposal) => void;
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
  canRetry,
  onRetry,
}: ChatMessagesProps) {
  const revealFrom = useRef(0);
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (busy && !wasBusy.current) revealFrom.current = history.length;
    wasBusy.current = busy;
  }, [busy, history.length]);

  const shown = streaming ? [...history, ...streaming.turns] : history;

  // propose_edit calls render as proposal cards; their paired tool results
  // are backend->model bookkeeping and would only add noise.
  const proposalCallIds = new Set(
    shown.flatMap((turn) =>
      turn.kind === "ToolCall" && turn.name === "propose_edit"
        ? [turn.call_id]
        : [],
    ),
  );

  return (
    <>
      {shown.map((turn, i) => {
        const reveal = i >= revealFrom.current;
        // A CSS custom property, not a standard style key - CSSProperties
        // doesn't type these, hence the cast.
        const style: CSSProperties | undefined = reveal
          ? ({
              "--reveal-delay": `${Math.min(i - revealFrom.current, 6) * 90}ms`,
            } as CSSProperties)
          : undefined;
        if (turn.kind === "ToolCall" && turn.name === "propose_edit") {
          const proposal = parseProposal(turn.arguments);
          if (!proposal)
            return <AgentTurnView key={i} turn={turn} labels={labels} />;
          const status = proposalStatus(turn.call_id);
          return (
            <div
              key={i}
              className={`agent-proposal${reveal ? " turn-reveal" : ""}`}
              style={style}
            >
              <div className="agent-proposal-title">
                {labels.proposalTitle} · {labels.actionNames[proposal.action]}
              </div>
              <ProposalDiff
                proposal={proposal}
                selectedText={selectedText}
                labels={labels}
              />
              {status === "pending" ? (
                <div className="agent-proposal-actions">
                  <button
                    className="inline-chat-action inline-chat-action-primary"
                    onClick={() => onAcceptProposal(turn.call_id)}
                  >
                    {labels.proposalAccept}
                  </button>
                  <button
                    className="inline-chat-action"
                    onClick={() => onRejectProposal(turn.call_id)}
                  >
                    {labels.proposalReject}
                  </button>
                </div>
              ) : status === "invalid" ? (
                // The anchor no longer resolves to exactly one place, so
                // there's nothing to preview and nothing safe to write. The
                // only honest move is to ask the model again against the
                // document as it now reads - applying this text blind is
                // what the old direct-apply fallback did, and it could land
                // an edit somewhere the user never saw highlighted.
                <>
                  <div className="agent-proposal-status agent-proposal-status-invalid">
                    {labels.proposalStatus.invalid}
                  </div>
                  <button
                    className="inline-chat-action"
                    onClick={() => onRelocateProposal(proposal)}
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
        if (turn.kind === "ToolResult" && proposalCallIds.has(turn.call_id))
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
        <div className="turn-reveal">
          <AgentTurnView
            turn={{ kind: "Assistant", text: streaming.text }}
            labels={labels}
          />
        </div>
      )}
      {busy && !streaming?.text && (
        <div className="agent-thinking">
          <span className="agent-thinking-label">{labels.thinking}</span>
          <span className="agent-thinking-dots">
            <span />
            <span />
            <span />
          </span>
        </div>
      )}
      {error && (
        <div className="agent-error">
          {error}
          {canRetry && (
            <button
              className="inline-chat-action agent-error-retry"
              onClick={onRetry}
            >
              {labels.retry}
            </button>
          )}
        </div>
      )}
    </>
  );
}

/**
 * What the edit changes, as a line-by-line diff.
 *
 * Shown in every state, not just the unresolvable one: this card is the only
 * place the before/after is spelled out, since the in-document marks
 * deliberately carry no detail. Lining the two sides up matters most for a
 * reworded sentence inside a paragraph - as two stacked blocks that meant
 * reading the whole paragraph twice to find what moved.
 */
function ProposalDiff({
  proposal,
  selectedText,
  labels,
}: {
  proposal: EditProposal;
  selectedText: string | null;
  labels: ChatMessagesLabels;
}) {
  const [expanded, setExpanded] = useState(false);

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

  const lines = diffLines(before, after);
  const long = isLongDiff(lines);
  const shown = long && !expanded ? lines.slice(0, 10) : lines;

  return (
    <div className="agent-proposal-diff">
      {shown.map((line, i) => (
        <div key={i} className={`agent-diff-line agent-diff-${line.kind}`}>
          <span className="agent-diff-marker" aria-hidden="true">
            {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
          </span>
          <span className="agent-diff-text">{line.text || "\u00a0"}</span>
        </div>
      ))}
      {long && (
        <button
          type="button"
          className="agent-diff-toggle"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded
            ? labels.diffCollapse
            : labels.diffExpand.replace("{n}", String(lines.length - 10))}
        </button>
      )}
    </div>
  );
}
