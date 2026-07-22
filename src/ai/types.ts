/**
 * The operations a propose_edit tool call can carry. Mirrors EDIT_ACTIONS in
 * src-tauri/src/ai/tools.rs - the backend validates proposals against the
 * same list, so the two must stay in sync.
 */
export type EditAction =
  | "replace"
  | "replace_selection"
  | "insert_before"
  | "insert_after"
  | "delete"
  | "append";

export const EDIT_ACTIONS: readonly EditAction[] = [
  "replace",
  "replace_selection",
  "insert_before",
  "insert_after",
  "delete",
  "append",
];

/** A validated propose_edit payload: what to do, where, and with what text. */
export interface EditProposal {
  action: EditAction;
  /** Exact document text the edit targets; absent for `append` and
   *  `replace_selection` (the latter targets the captured selection). */
  anchor?: string;
  /** New markdown content; absent only for `delete`. */
  text?: string;
  /** A longer verbatim quote containing `anchor`, itself unique in the
   *  document - disambiguates which occurrence a repeated anchor means
   *  (see findMarkdownMatch). Mirrors the `context` field tools.rs offers. */
  context?: string;
}

/**
 * One skill from the agent workspace (global dir or the document folder's
 * .levis/skills/*.md files) - see src-tauri/src/ai/workspace.rs. The
 * frontend only needs name/description for the /name picker; the prompt is
 * used when the user forces a skill manually.
 */
export interface AgentSkill {
  name: string;
  description: string;
  prompt: string;
}

/** A file attached to an outgoing chat message via the "+" button. */
export interface ChatAttachment {
  name: string;
  content: string;
}

export type AgentTurn =
  | { kind: "User"; text: string }
  | { kind: "Assistant"; text: string }
  | { kind: "ToolCall"; call_id: string; name: string; arguments: string }
  | { kind: "ToolResult"; call_id: string; output: string };
