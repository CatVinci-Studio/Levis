import { useRef, useState } from "react";
import { useAgentConversation } from "./useAgentConversation";
import { AgentTurnView } from "./AgentTurnView";
import { useCloseOnOutsideClick } from "../utils/useCloseOnOutsideClick";
import { useViewportClamp } from "../utils/useViewportClamp";
import type { ApplyTarget } from "./useInlineChat";
import { EDIT_ACTIONS, type EditAction, type EditProposal } from "./types";
import "./AgentTurnView.css";
import "./InlineChatBar.css";

export interface InlineChatLabels {
  placeholder: string;
  send: string;
  thinking: string;
  selectionHint: string;
  replaceSelection: string;
  insertAtCursor: string;
  replaceDocument: string;
  proposalTitle: string;
  proposalApply: string;
  proposalApplied: string;
  /** Human name of each propose_edit action, shown on the proposal card. */
  actionNames: Record<EditAction, string>;
}

interface InlineChatBarProps {
  x: number;
  y: number;
  document: string;
  selectedText: string | null;
  provider: string;
  labels: InlineChatLabels;
  /** Writes an AI reply into the document; returns an error string to show, or null on success. */
  onApply: (text: string, target: ApplyTarget) => string | null;
  /** Applies one propose_edit tool call; same error contract as onApply. */
  onApplyProposal: (proposal: EditProposal) => string | null;
  onClose: () => void;
}

/**
 * A propose_edit tool call's arguments as a validated EditProposal, or null
 * if they don't parse or are missing what their action requires (same rules
 * the backend tool validates against).
 */
function parseProposal(argumentsJson: string): EditProposal | null {
  try {
    const parsed = JSON.parse(argumentsJson);
    const action = parsed.action as EditAction;
    if (!EDIT_ACTIONS.includes(action)) return null;
    const anchor = typeof parsed.anchor === "string" && parsed.anchor ? parsed.anchor : undefined;
    const text = typeof parsed.text === "string" ? parsed.text : undefined;
    if (action !== "append" && !anchor) return null;
    if (action !== "delete" && text === undefined) return null;
    return { action, anchor, text };
  } catch {
    return null;
  }
}

/**
 * Models sometimes wrap a requested rewrite in a markdown code fence -
 * unwrap it so applying inserts the content, not a code block.
 */
function extractReplacement(text: string): string {
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(text.trim());
  return fenced ? fenced[1] : text.trim();
}

/// A cursor-anchored inline assistant bar - invoked via shortcut or the
/// context menu, styled after VS Code's inline Claude Code chat: a single
/// input + send button, not a persistent panel. If text was selected at
/// invocation time it's silently attached to the outgoing message wrapped
/// in a `<selected-text>` tag, and every reply offers apply actions
/// (replace selection / insert at cursor / replace document) as the
/// explicit confirmation step for AI edits - nothing touches the document
/// until one of them is clicked, and history (Cmd+Z) undoes an apply.
export function InlineChatBar({
  x,
  y,
  document,
  selectedText,
  provider,
  labels,
  onApply,
  onApplyProposal,
  onClose,
}: InlineChatBarProps) {
  const [input, setInput] = useState("");
  const [applyError, setApplyError] = useState<string | null>(null);
  const [appliedProposals, setAppliedProposals] = useState<ReadonlySet<string>>(new Set());
  const { history, busy, error, send } = useAgentConversation(document, provider);
  const rootRef = useCloseOnOutsideClick<HTMLDivElement>(onClose);
  const listRef = useRef<HTMLDivElement>(null);
  const pos = useViewportClamp(rootRef, x, y);

  const lastReply = [...history].reverse().find((turn) => turn.kind === "Assistant");
  // propose_edit calls render as proposal cards; their paired tool results
  // are backend->model bookkeeping and would only add noise.
  const proposalCallIds = new Set(
    history.flatMap((turn) => (turn.kind === "ToolCall" && turn.name === "propose_edit" ? [turn.call_id] : [])),
  );

  function applyProposal(callId: string, proposal: EditProposal) {
    const err = onApplyProposal(proposal);
    if (err) setApplyError(err);
    else {
      setApplyError(null);
      setAppliedProposals((prev) => new Set(prev).add(callId));
    }
  }

  async function submit() {
    const message = input.trim();
    if (!message) return;
    setInput("");
    setApplyError(null);
    // The rewrite note keeps replies applyable: without it, models wrap the
    // revised text in commentary ("Sure, here's a better version: ..."),
    // and the apply buttons would paste that chatter into the document.
    const tagged = selectedText
      ? `<selected-text>\n${selectedText}\n</selected-text>\n\n${message}\n\n(If this asks you to rewrite or modify the selected text and you are not using an edit tool, reply with ONLY the replacement text - no commentary, no quotes, no code fences.)`
      : message;
    await send(tagged);
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    });
  }

  function apply(target: ApplyTarget) {
    if (!lastReply || lastReply.kind !== "Assistant") return;
    const err = onApply(extractReplacement(lastReply.text), target);
    if (err) setApplyError(err);
    else onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
    if (e.key === "Escape") onClose();
  }

  return (
    <div ref={rootRef} className="inline-chat" style={pos}>
      {selectedText && <div className="inline-chat-selection-hint">{labels.selectionHint}</div>}
      <div className="inline-chat-bar floating-surface">
        <textarea
          className="inline-chat-input"
          rows={1}
          placeholder={labels.placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
        />
        <button className="inline-chat-send" onClick={submit} disabled={busy || !input.trim()}>
          {labels.send}
        </button>
      </div>
      {(history.length > 0 || busy || error) && (
        <div className="inline-chat-messages floating-surface" ref={listRef}>
          {history.map((turn, i) => {
            if (turn.kind === "ToolCall" && turn.name === "propose_edit") {
              const proposal = parseProposal(turn.arguments);
              if (!proposal) return <AgentTurnView key={i} turn={turn} />;
              const applied = appliedProposals.has(turn.call_id);
              // What the diff shows depends on the action: replace/delete
              // strike the anchor; anything with new text inserts it. An
              // insert's anchor is untouched context, so it renders as
              // plain text rather than a deletion.
              const showsDeletion = proposal.action === "replace" || proposal.action === "delete";
              return (
                <div key={i} className="agent-proposal">
                  <div className="agent-proposal-title">
                    {labels.proposalTitle} · {labels.actionNames[proposal.action]}
                  </div>
                  <div className="agent-proposal-diff">
                    {proposal.action === "insert_before" && <ins>{proposal.text}</ins>}
                    {proposal.anchor !== undefined &&
                      (showsDeletion ? <del>{proposal.anchor}</del> : <span>{proposal.anchor}</span>)}
                    {proposal.action !== "insert_before" && proposal.text !== undefined && <ins>{proposal.text}</ins>}
                  </div>
                  <button
                    className="inline-chat-action inline-chat-action-primary"
                    disabled={applied}
                    onClick={() => applyProposal(turn.call_id, proposal)}
                  >
                    {applied ? labels.proposalApplied : labels.proposalApply}
                  </button>
                </div>
              );
            }
            if (turn.kind === "ToolResult" && proposalCallIds.has(turn.call_id)) return null;
            return <AgentTurnView key={i} turn={turn} />;
          })}
          {busy && <div className="agent-thinking">{labels.thinking}</div>}
          {error && <div className="agent-error">{error}</div>}
          {applyError && <div className="agent-error">{applyError}</div>}
          {lastReply && !busy && (
            <div className="inline-chat-actions">
              {selectedText ? (
                <button className="inline-chat-action inline-chat-action-primary" onClick={() => apply("selection")}>
                  {labels.replaceSelection}
                </button>
              ) : (
                <button className="inline-chat-action inline-chat-action-primary" onClick={() => apply("cursor")}>
                  {labels.insertAtCursor}
                </button>
              )}
              <button className="inline-chat-action" onClick={() => apply("document")}>
                {labels.replaceDocument}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
