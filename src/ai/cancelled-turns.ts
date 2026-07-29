import type { AgentTurn } from "./types";

/** Synthetic result paired onto a ToolCall the stop interrupted before its
 *  real result streamed - providers reject a replayed history containing an
 *  unanswered tool call, so the pair must be closed before these turns can
 *  enter `history`. */
export const STOPPED_TOOL_RESULT =
  "Generation was stopped by the user before this tool call finished.";

/**
 * What a stopped exchange keeps: everything that already streamed (and was
 * therefore already on screen), rather than dropping the whole exchange the
 * way a failure does. `streamed` is the StreamingState turn list - the
 * echoed user message plus every completed intermediate turn - and
 * `partialText` the assistant prose cut off mid-generation, appended as a
 * final Assistant turn so the reply the user watched arrive stays in the
 * transcript.
 *
 * Returns [] when nothing beyond the echoed user message ever streamed -
 * recording a user message with no reply at all would read as the model
 * silently ignoring it, so an immediately-stopped send still vanishes
 * wholesale (the pre-existing behavior).
 */
export function keepCancelledTurns(
  streamed: AgentTurn[],
  partialText: string,
): AgentTurn[] {
  const text = partialText.trim() ? partialText : "";
  if (!text && streamed.every((t) => t.kind === "User")) return [];
  const closed: AgentTurn[] = [];
  for (let i = 0; i < streamed.length; i++) {
    const turn = streamed[i];
    closed.push(turn);
    if (turn.kind !== "ToolCall") continue;
    const answered = streamed.some(
      (t, j) => j > i && t.kind === "ToolResult" && t.call_id === turn.call_id,
    );
    if (!answered)
      closed.push({
        kind: "ToolResult",
        call_id: turn.call_id,
        output: STOPPED_TOOL_RESULT,
      });
  }
  if (text) closed.push({ kind: "Assistant", text });
  return closed;
}
