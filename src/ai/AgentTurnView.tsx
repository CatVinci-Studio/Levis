import type { AgentTurn } from "./types";
import { MarkdownText } from "./MarkdownText";
import "./AgentTurnView.css";

export function AgentTurnView({ turn }: { turn: AgentTurn }) {
  switch (turn.kind) {
    case "User":
      return (
        <div className="agent-message agent-message-user">{turn.text}</div>
      );
    case "Assistant":
      return (
        <div className="agent-message agent-message-assistant">
          <MarkdownText text={turn.text} />
        </div>
      );
    case "ToolCall":
      return <div className="agent-tool-line">🔍 {turn.name}</div>;
    case "ToolResult":
      return (
        <details className="agent-tool-result">
          <summary>tool result</summary>
          <pre>{turn.output}</pre>
        </details>
      );
    default:
      return null;
  }
}
