/**
 * The operations a propose_edit tool call can carry. Mirrors EDIT_ACTIONS in
 * src-tauri/src/ai/tools.rs - the backend validates proposals against the
 * same list, so the two must stay in sync.
 */
export type EditAction = "replace" | "insert_before" | "insert_after" | "delete" | "append";

export const EDIT_ACTIONS: readonly EditAction[] = ["replace", "insert_before", "insert_after", "delete", "append"];

/** A validated propose_edit payload: what to do, where, and with what text. */
export interface EditProposal {
  action: EditAction;
  /** Exact document text the edit targets; absent only for `append`. */
  anchor?: string;
  /** New markdown content; absent only for `delete`. */
  text?: string;
}

export type AgentTurn =
  | { kind: "User"; text: string }
  | { kind: "Assistant"; text: string }
  | { kind: "ToolCall"; call_id: string; name: string; arguments: string }
  | { kind: "ToolResult"; call_id: string; output: string };
