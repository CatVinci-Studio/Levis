import { useRef, useState } from "react";
import type { AgentConversation } from "../useAgentConversation";
import { useCloseOnOutsideClick } from "../../utils/useCloseOnOutsideClick";
import { useViewportClamp } from "../../utils/useViewportClamp";
import type { ApplyTarget, InlineChatInfo } from "../useInlineChat";
import type { PendingStatus } from "../usePendingEdits";
import { useChatHistory, conversationTitle, type ChatHistoryEntry } from "../chat-history";
import type { ChatAttachment, EditAction, EditProposal } from "../types";
import { ChatHeader, type ChatHeaderLabels } from "./ChatHeader";
import { ChatHistoryMenu } from "./ChatHistoryMenu";
import { ChatMessages } from "./ChatMessages";
import { ChatComposer } from "./ChatComposer";
import { extractReplacement, parseProposal } from "./proposal";
import "../AgentTurnView.css";
import "./inline-chat.css";

export interface InlineChatLabels extends ChatHeaderLabels {
  placeholder: string;
  send: string;
  thinking: string;
  attachFile: string;
  selectedChars: string;
  replaceSelection: string;
  insertAtCursor: string;
  replaceDocument: string;
  proposalTitle: string;
  proposalApply: string;
  proposalStatus: Record<Exclude<PendingStatus, "pending">, string>;
  proposalAccept: string;
  proposalReject: string;
  actionNames: Record<EditAction, string>;
  historyEmpty: string;
  historyDelete: string;
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
  /** Conversation state owned by the editor, so it survives the bar closing. */
  conversation: AgentConversation;
  labels: InlineChatLabels;
  /** Writes an AI reply into the document; returns an error string to show, or null on success. */
  onApply: (text: string, target: ApplyTarget) => string | null;
  /** Fallback for a proposal whose anchor couldn't be resolved into a live
   *  preview (status "invalid") - applies it directly, same error contract
   *  as onApply. */
  onApplyProposal: (proposal: EditProposal) => string | null;
  /** A reply produced one or more propose_edit tool calls - hand them to
   *  usePendingEdits.showPreviews so they render as in-document previews. */
  onProposals: (proposals: { callId: string; proposal: EditProposal }[], chatInfo: InlineChatInfo) => void;
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
/// <selected-text> tag, and every reply offers apply actions (replace
/// selection / insert at cursor / replace document) as the explicit
/// confirmation step for free-text replies - nothing touches the document
/// until one of them (or a propose_edit Accept) is clicked, and history
/// (Cmd+Z) undoes an apply.
///
/// Split across chat/ by responsibility: this file is the shell (position,
/// outside-click close, orchestrating a send) plus the header/history
/// dropdown; ChatMessages owns the turn list and proposal cards;
/// ChatComposer owns the input row and skill picker.
export function InlineChat({
  x,
  y,
  document,
  selectedText,
  docPath,
  chatInfo,
  conversation,
  labels,
  onApply,
  onApplyProposal,
  onProposals,
  proposalStatus,
  onAcceptProposal,
  onRejectProposal,
  onClose,
}: InlineChatProps) {
  const [applyError, setApplyError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { history, busy, error, send, reset, restore } = conversation;
  const historyEntries = useChatHistory();

  const rootRef = useCloseOnOutsideClick<HTMLDivElement>(onClose);
  const listRef = useRef<HTMLDivElement>(null);
  const pos = useViewportClamp(rootRef, x, y);

  function applyInvalidProposal(proposal: EditProposal) {
    const err = onApplyProposal(proposal);
    setApplyError(err);
  }

  function handleSend(message: string, attachments: ChatAttachment[]) {
    setApplyError(null);
    setHistoryOpen(false);
    // Rewrites of the selection come back as replace_selection tool calls
    // (see AGENT_TOOL_INSTRUCTIONS in src-tauri/src/ai/agent.rs) - the tag
    // here just carries the selection as context.
    const tagged = selectedText ? `<selected-text>\n${selectedText}\n</selected-text>\n\n${message}` : message;
    // Attachments ride inside this one message, ahead of the request text.
    const attachmentBlocks = attachments
      .map((f) => `<attached-file name="${f.name}">\n${f.content}\n</attached-file>`)
      .join("\n\n");
    // Snapshot chatInfo now (request time), not read from props later - the
    // bar (or a differently-anchored reopening of it) may not still reflect
    // this request's context by the time the reply arrives.
    const requestChatInfo = chatInfo;
    void (async () => {
      const newTurns = await send(document, attachmentBlocks ? `${attachmentBlocks}\n\n${tagged}` : tagged);
      const proposals = (newTurns ?? []).flatMap((turn) => {
        if (turn.kind !== "ToolCall" || turn.name !== "propose_edit") return [];
        const proposal = parseProposal(turn.arguments);
        return proposal ? [{ callId: turn.call_id, proposal }] : [];
      });
      if (proposals.length > 0) onProposals(proposals, requestChatInfo);
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
      });
    })();
  }

  function apply(target: ApplyTarget) {
    const lastReply = [...history].reverse().find((turn) => turn.kind === "Assistant");
    if (!lastReply || lastReply.kind !== "Assistant") return;
    const err = onApply(extractReplacement(lastReply.text), target);
    if (err) setApplyError(err);
    else onClose();
  }

  function startNewChat() {
    reset();
    setApplyError(null);
    setHistoryOpen(false);
  }

  function restoreFromHistory(entry: ChatHistoryEntry) {
    restore(entry);
    setApplyError(null);
    setHistoryOpen(false);
  }

  const showPanel = history.length > 0 || busy || !!error || historyEntries.length > 0;

  return (
    <div ref={rootRef} className="inline-chat" style={pos}>
      {/* History renders above the input, newest at the bottom - the
          conventional chat layout (ChatGPT, Claude), not input-on-top. */}
      {showPanel && (
        <div className="inline-chat-panel floating-surface">
          <ChatHeader
            title={conversationTitle(history)}
            hasHistory={historyEntries.length > 0}
            historyOpen={historyOpen}
            onToggleHistory={() => setHistoryOpen((v) => !v)}
            onNewChat={startNewChat}
            onClose={onClose}
            labels={labels}
          />
          {historyOpen && (
            <ChatHistoryMenu emptyLabel={labels.historyEmpty} deleteLabel={labels.historyDelete} onRestore={restoreFromHistory} />
          )}
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
              onApply={apply}
            />
          </div>
        </div>
      )}
      <ChatComposer
        docPath={docPath}
        selectedText={selectedText}
        busy={busy}
        labels={labels}
        onSend={handleSend}
        onEscape={onClose}
      />
    </div>
  );
}
