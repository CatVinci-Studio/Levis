import { useEffect, useRef, type CSSProperties } from "react";
import { AgentTurnView } from "../AgentTurnView";
import type { AgentTurn, EditAction, EditProposal } from "../types";
import type { PendingStatus } from "../usePendingEdits";
import type { ApplyTarget } from "../useInlineChat";
import { parseProposal } from "./proposal";

export interface ChatMessagesLabels {
  thinking: string;
  replaceSelection: string;
  insertAtCursor: string;
  replaceDocument: string;
  proposalTitle: string;
  proposalApply: string;
  proposalStatus: Record<Exclude<PendingStatus, "pending">, string>;
  proposalAccept: string;
  proposalReject: string;
  actionNames: Record<EditAction, string>;
}

interface ChatMessagesProps {
  history: AgentTurn[];
  busy: boolean;
  error: string | null;
  applyError: string | null;
  selectedText: string | null;
  labels: ChatMessagesLabels;
  proposalStatus: (callId: string) => PendingStatus;
  onAcceptProposal: (callId: string) => void;
  onRejectProposal: (callId: string) => void;
  onApplyInvalidProposal: (proposal: EditProposal) => void;
  onApply: (target: ApplyTarget) => void;
}

/**
 * The turn history: proposal cards, plain turns, the busy/error states, and
 * the free-text apply actions under the latest reply. Newly arrived turns
 * (everything from the index history had before the last send) get a small
 * staggered fade-in - the reply still lands all at once (no token
 * streaming), this just avoids it appearing as one flat block.
 */
export function ChatMessages({
  history,
  busy,
  error,
  applyError,
  selectedText,
  labels,
  proposalStatus,
  onAcceptProposal,
  onRejectProposal,
  onApplyInvalidProposal,
  onApply,
}: ChatMessagesProps) {
  const revealFrom = useRef(0);
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (busy && !wasBusy.current) revealFrom.current = history.length;
    wasBusy.current = busy;
  }, [busy, history.length]);

  const lastReply = [...history].reverse().find((turn) => turn.kind === "Assistant");
  // propose_edit calls render as proposal cards; their paired tool results
  // are backend->model bookkeeping and would only add noise.
  const proposalCallIds = new Set(
    history.flatMap((turn) => (turn.kind === "ToolCall" && turn.name === "propose_edit" ? [turn.call_id] : [])),
  );
  // Whether the latest exchange (everything after the last user turn)
  // produced proposal cards. If so, they are the apply path - the free-text
  // apply buttons below would just paste the model's commentary.
  let lastUserIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].kind === "User") {
      lastUserIndex = i;
      break;
    }
  }
  const lastExchangeHasProposal = history
    .slice(lastUserIndex + 1)
    .some((turn) => turn.kind === "ToolCall" && turn.name === "propose_edit");

  return (
    <>
      {history.map((turn, i) => {
        const reveal = i >= revealFrom.current;
        // A CSS custom property, not a standard style key - CSSProperties
        // doesn't type these, hence the cast.
        const style: CSSProperties | undefined = reveal
          ? ({ "--reveal-delay": `${Math.min(i - revealFrom.current, 6) * 90}ms` } as CSSProperties)
          : undefined;
        if (turn.kind === "ToolCall" && turn.name === "propose_edit") {
          const proposal = parseProposal(turn.arguments);
          if (!proposal) return <AgentTurnView key={i} turn={turn} />;
          const status = proposalStatus(turn.call_id);
          return (
            <div key={i} className={`agent-proposal${reveal ? " turn-reveal" : ""}`} style={style}>
              <div className="agent-proposal-title">
                {labels.proposalTitle} · {labels.actionNames[proposal.action]}
              </div>
              {status === "invalid" ? (
                // No live document preview to point at (the anchor no
                // longer resolves uniquely) - fall back to the inline
                // diff and a direct-apply button, same as before this
                // feature existed.
                <>
                  <div className="agent-proposal-diff">
                    {proposal.action === "insert_before" && <ins>{proposal.text}</ins>}
                    {(() => {
                      const showsDeletion =
                        proposal.action === "replace" ||
                        proposal.action === "delete" ||
                        proposal.action === "replace_selection";
                      const struck =
                        proposal.action === "replace_selection" ? (selectedText ?? undefined) : proposal.anchor;
                      return struck !== undefined && (showsDeletion ? <del>{struck}</del> : <span>{struck}</span>);
                    })()}
                    {proposal.action !== "insert_before" && proposal.text !== undefined && <ins>{proposal.text}</ins>}
                  </div>
                  <div className="agent-proposal-status agent-proposal-status-invalid">{labels.proposalStatus.invalid}</div>
                  <button
                    className="inline-chat-action inline-chat-action-primary"
                    onClick={() => onApplyInvalidProposal(proposal)}
                  >
                    {labels.proposalApply}
                  </button>
                </>
              ) : status === "pending" ? (
                <div className="agent-proposal-actions">
                  <button
                    className="inline-chat-action inline-chat-action-primary"
                    onClick={() => onAcceptProposal(turn.call_id)}
                  >
                    {labels.proposalAccept}
                  </button>
                  <button className="inline-chat-action" onClick={() => onRejectProposal(turn.call_id)}>
                    {labels.proposalReject}
                  </button>
                </div>
              ) : (
                <div className={`agent-proposal-status agent-proposal-status-${status}`}>{labels.proposalStatus[status]}</div>
              )}
            </div>
          );
        }
        if (turn.kind === "ToolResult" && proposalCallIds.has(turn.call_id)) return null;
        return (
          <div key={i} className={reveal ? "turn-reveal" : undefined} style={style}>
            <AgentTurnView turn={turn} />
          </div>
        );
      })}
      {busy && (
        <div className="agent-thinking">
          <span className="agent-thinking-label">{labels.thinking}</span>
          <span className="agent-thinking-dots">
            <span />
            <span />
            <span />
          </span>
        </div>
      )}
      {error && <div className="agent-error">{error}</div>}
      {applyError && <div className="agent-error">{applyError}</div>}
      {lastReply && !busy && !lastExchangeHasProposal && (
        <div className="inline-chat-actions">
          {selectedText ? (
            <button className="inline-chat-action inline-chat-action-primary" onClick={() => onApply("selection")}>
              {labels.replaceSelection}
            </button>
          ) : (
            <button className="inline-chat-action inline-chat-action-primary" onClick={() => onApply("cursor")}>
              {labels.insertAtCursor}
            </button>
          )}
          <button className="inline-chat-action" onClick={() => onApply("document")}>
            {labels.replaceDocument}
          </button>
        </div>
      )}
    </>
  );
}
