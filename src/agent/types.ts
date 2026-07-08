export type AgentTurn =
  | { kind: "User"; text: string }
  | { kind: "Assistant"; text: string }
  | { kind: "ToolCall"; call_id: string; name: string; arguments: string }
  | { kind: "ToolResult"; call_id: string; output: string };
