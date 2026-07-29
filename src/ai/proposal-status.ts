import type { AgentTurn } from "./types";
import type { PendingStatus } from "./usePendingEdits";

/**
 * What each status means for the model, appended to the proposal's tool
 * result at request time. The wording leans on one fact the model can't
 * infer on its own: the document it is shown each turn contains ONLY
 * accepted edits, so an undecided or rejected proposal is absent from it -
 * without saying so, the model assumes its last proposal landed and either
 * re-proposes it or anchors follow-ups to text that isn't in the document.
 */
const STATUS_NOTES: Record<PendingStatus, string> = {
  pending:
    "Status: the user has NOT yet accepted or rejected this proposed edit. It is still shown to them as a preview and is NOT part of the document text in this request - do not assume it was applied, and do not anchor new edits to its text.",
  // Still revealing/arguments still arriving - same consequence as pending.
  streaming:
    "Status: the user has NOT yet accepted or rejected this proposed edit. It is still shown to them as a preview and is NOT part of the document text in this request - do not assume it was applied, and do not anchor new edits to its text.",
  accepted:
    "Status: the user accepted this proposed edit - the document text in this request includes it.",
  rejected:
    "Status: the user rejected this proposed edit - it was not applied. Don't propose it again unless asked.",
  invalid:
    "Status: this proposed edit could not be applied (the text it targeted changed) and was discarded - it is not part of the document.",
};

/**
 * The conversation history as sent to the backend, with each propose_edit
 * tool result annotated with the proposal's CURRENT status. Applied fresh on
 * every send (never persisted - the stored history stays clean, and a status
 * can still change between sends). `statuses` is usePendingEdits'
 * `allStatuses`: only propose_edit call ids ever enter it, so presence in
 * the map is what identifies a proposal's result - a tool result absent from
 * it (other tools, or a proposal that failed validation and never became a
 * preview) passes through untouched.
 *
 * The backend counterpart: tools.rs's propose_edit result tells the model
 * "the user now sees it with an Apply button"; this is the follow-up that
 * result promises nothing about, and agent.rs's AGENT_TOOL_INSTRUCTIONS
 * tells the model to expect it.
 */
export function annotateProposalStatuses(
  history: AgentTurn[],
  statuses: Record<string, PendingStatus>,
): AgentTurn[] {
  if (Object.keys(statuses).length === 0) return history;
  return history.map((turn) => {
    if (turn.kind !== "ToolResult") return turn;
    const status = statuses[turn.call_id];
    if (!status) return turn;
    return { ...turn, output: `${turn.output}\n\n[${STATUS_NOTES[status]}]` };
  });
}
