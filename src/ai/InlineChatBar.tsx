import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentConversation } from "./useAgentConversation";
import { AgentTurnView } from "./AgentTurnView";
import { useCloseOnOutsideClick } from "../utils/useCloseOnOutsideClick";
import { useViewportClamp } from "../utils/useViewportClamp";
import { normalizeMathDelimiters } from "../utils/markdown-math";
import type { ApplyTarget } from "./useInlineChat";
import { EDIT_ACTIONS, type AgentSkill, type ChatAttachment, type EditAction, type EditProposal } from "./types";
import "./AgentTurnView.css";
import "./InlineChatBar.css";

export interface InlineChatLabels {
  placeholder: string;
  send: string;
  thinking: string;
  /** The button that clears the persisted conversation and starts fresh. */
  newChat: string;
  /** Tooltip of the "+" attach-file button. */
  attachFile: string;
  /** The selection chip's text; "{n}" is replaced with the char count. */
  selectedChars: string;
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
  /** The document's path - resolves the agent workspace (skills, files). */
  docPath: string | null;
  /** Conversation state owned by the editor, so it survives the bar closing. */
  conversation: AgentConversation;
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
    // Only the inserted text, never the anchor - the anchor must stay a
    // verbatim quote of the document to match.
    const text = typeof parsed.text === "string" ? normalizeMathDelimiters(parsed.text) : undefined;
    if (action !== "append" && action !== "replace_selection" && !anchor) return null;
    if (action !== "delete" && text === undefined) return null;
    return { action, anchor, text };
  } catch {
    return null;
  }
}

/**
 * Best-effort recovery of the intended content from a free-text reply (the
 * fallback path when the model edited without the propose_edit tool).
 * Models tend to wrap the requested rewrite in a markdown code fence, often
 * with a line of preamble around it - unwrap the fence so applying inserts
 * the content, not a code block plus chatter.
 */
function extractReplacement(text: string): string {
  const trimmed = text.trim();
  const wholeFence = /^```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(trimmed);
  if (wholeFence) return normalizeMathDelimiters(wholeFence[1]);
  // Exactly one fenced block inside prose ("Sure, here's the new version:
  // ```...```") - the block is the payload, the prose is commentary.
  const fences = [...trimmed.matchAll(/```[^\n]*\n([\s\S]*?)\n?```/g)];
  if (fences.length === 1) return normalizeMathDelimiters(fences[0][1]);
  return normalizeMathDelimiters(trimmed);
}

/**
 * Resolves a leading /name skill invocation: the skill's prompt becomes the
 * message body, with whatever followed the name appended as extra input.
 * A slash token that doesn't name a skill is left alone - it might just be
 * text that starts with a slash.
 */
function resolveSkillMessage(message: string, skills: AgentSkill[]): string {
  const m = /^\/(\S+)\s*([\s\S]*)$/.exec(message);
  if (!m) return message;
  const skill = skills.find((s) => s.name === m[1]);
  if (!skill) return message;
  return m[2] ? `${skill.prompt}\n\n${m[2]}` : skill.prompt;
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
  docPath,
  conversation,
  labels,
  onApply,
  onApplyProposal,
  onClose,
}: InlineChatBarProps) {
  const [input, setInput] = useState("");
  const [skillIndex, setSkillIndex] = useState(0);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [appliedProposals, setAppliedProposals] = useState<ReadonlySet<string>>(new Set());
  const { history, busy, error, send, reset } = conversation;

  // Skills come from the agent workspace on disk (global dir + the document
  // folder's .levis/skills). Loaded fresh each time the chat opens, so
  // editing a skill file takes effect on the next chat without a restart.
  useEffect(() => {
    let cancelled = false;
    invoke<{ skills: AgentSkill[] } | null>("load_agent_workspace", { docPath })
      .then((ws) => {
        if (!cancelled && ws?.skills) setSkills(ws.skills);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [docPath]);

  async function attachFile() {
    try {
      const file = await invoke<ChatAttachment | null>("pick_attachment_file");
      if (file) setAttachments((prev) => [...prev, file]);
    } catch (err) {
      setApplyError(String(err));
    }
  }
  const rootRef = useCloseOnOutsideClick<HTMLDivElement>(onClose);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pos = useViewportClamp(rootRef, x, y);

  // The input grows with its content (Shift+Enter newlines) up to the CSS
  // max-height, then scrolls - a fixed single row just scrolled horizontally
  // out of view.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // Reopening with a persisted conversation should land at its latest
  // exchange, not its beginning.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, []);

  // Skill picker: open while the input is a single /token still being typed
  // (no space yet), filtered by that prefix. Purely derived from the input,
  // so it closes itself once the name is completed or the slash is deleted.
  const skillQuery = /^\/(\S*)$/.exec(input);
  const matchingSkills = skillQuery
    ? skills.filter((s) => s.name.toLowerCase().startsWith(skillQuery[1].toLowerCase()))
    : [];
  const activeSkillIndex = Math.min(skillIndex, Math.max(0, matchingSkills.length - 1));

  function pickSkill(skill: AgentSkill) {
    setInput(`/${skill.name} `);
    setSkillIndex(0);
  }

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

  function applyProposal(callId: string, proposal: EditProposal) {
    const err = onApplyProposal(proposal);
    if (err) setApplyError(err);
    else {
      setApplyError(null);
      setAppliedProposals((prev) => new Set(prev).add(callId));
    }
  }

  async function submit() {
    const message = resolveSkillMessage(input.trim(), skills);
    if (!message) return;
    setInput("");
    setApplyError(null);
    // Rewrites of the selection come back as replace_selection tool calls
    // (see AGENT_TOOL_INSTRUCTIONS in src-tauri/src/ai/agent.rs) - the tag
    // here just carries the selection as context.
    const tagged = selectedText ? `<selected-text>\n${selectedText}\n</selected-text>\n\n${message}` : message;
    // Attachments ride inside this one message, ahead of the request text.
    const attachmentBlocks = attachments
      .map((f) => `<attached-file name="${f.name}">\n${f.content}\n</attached-file>`)
      .join("\n\n");
    setAttachments([]);
    await send(document, attachmentBlocks ? `${attachmentBlocks}\n\n${tagged}` : tagged);
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

  function startNewChat() {
    reset();
    setAppliedProposals(new Set());
    setApplyError(null);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // Keys pressed while an IME composition is active belong to the IME
    // (Enter confirms the composed characters, arrows navigate candidates) -
    // acting on them here sent half-typed CJK messages. WebKit can also fire
    // the confirming keydown just after compositionend with isComposing
    // already false but the legacy keyCode still 229, so check both.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // While the skill picker is open, the navigation keys drive it instead
    // of the chat (Enter completes the skill name rather than sending).
    if (matchingSkills.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setSkillIndex((activeSkillIndex + delta + matchingSkills.length) % matchingSkills.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickSkill(matchingSkills[activeSkillIndex]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
    if (e.key === "Escape") onClose();
  }

  return (
    <div ref={rootRef} className="inline-chat" style={pos}>
      <div className="inline-chat-bar floating-surface">
        {attachments.length > 0 && (
          <div className="inline-chat-attachments">
            {attachments.map((file, i) => (
              <span key={i} className="inline-chat-attachment">
                {file.name}
                <button
                  className="inline-chat-attachment-remove"
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          className="inline-chat-input"
          rows={1}
          placeholder={labels.placeholder}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setSkillIndex(0);
          }}
          onKeyDown={onKeyDown}
          autoFocus
        />
        <div className="inline-chat-toolbar">
          <button className="inline-chat-attach" title={labels.attachFile} onClick={attachFile}>
            +
          </button>
          {selectedText && (
            <span className="inline-chat-selection-chip">
              {labels.selectedChars.replace("{n}", String([...selectedText].length))}
            </span>
          )}
          <button className="inline-chat-send" onClick={submit} disabled={busy || !input.trim()}>
            {labels.send}
          </button>
        </div>
      </div>
      {matchingSkills.length > 0 && (
        <div className="inline-chat-skill-menu floating-surface">
          {matchingSkills.map((skill, i) => (
            <button
              key={skill.name}
              className={`inline-chat-skill-item ${i === activeSkillIndex ? "inline-chat-skill-item-active" : ""}`}
              // mousedown, not click: keeps focus in the textarea.
              onMouseDown={(e) => {
                e.preventDefault();
                pickSkill(skill);
              }}
            >
              <span className="inline-chat-skill-name">/{skill.name}</span>
              <span className="inline-chat-skill-preview">{skill.description || skill.prompt}</span>
            </button>
          ))}
        </div>
      )}
      {(history.length > 0 || busy || error) && (
        <div className="inline-chat-messages floating-surface" ref={listRef}>
          {history.length > 0 && (
            <div className="inline-chat-messages-header">
              <button className="inline-chat-newchat" onClick={startNewChat}>
                {labels.newChat}
              </button>
            </div>
          )}
          {history.map((turn, i) => {
            if (turn.kind === "ToolCall" && turn.name === "propose_edit") {
              const proposal = parseProposal(turn.arguments);
              if (!proposal) return <AgentTurnView key={i} turn={turn} />;
              const applied = appliedProposals.has(turn.call_id);
              // What the diff shows depends on the action: replace/delete
              // strike the anchor (replace_selection strikes the captured
              // selection - it carries no anchor); anything with new text
              // inserts it. An insert's anchor is untouched context, so it
              // renders as plain text rather than a deletion.
              const showsDeletion =
                proposal.action === "replace" || proposal.action === "delete" || proposal.action === "replace_selection";
              const struck = proposal.action === "replace_selection" ? (selectedText ?? undefined) : proposal.anchor;
              return (
                <div key={i} className="agent-proposal">
                  <div className="agent-proposal-title">
                    {labels.proposalTitle} · {labels.actionNames[proposal.action]}
                  </div>
                  <div className="agent-proposal-diff">
                    {proposal.action === "insert_before" && <ins>{proposal.text}</ins>}
                    {struck !== undefined && (showsDeletion ? <del>{struck}</del> : <span>{struck}</span>)}
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
          {lastReply && !busy && !lastExchangeHasProposal && (
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
