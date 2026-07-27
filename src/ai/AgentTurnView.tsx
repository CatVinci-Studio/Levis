import { useState } from "react";
import type { AgentTurn, ImageAttachment } from "./types";
import { MarkdownText } from "./MarkdownText";
import { parseUserMessage } from "./chat/user-message";
import { ChevronIcon, PaperclipIcon, SearchIcon } from "../ui/icons";
import "./AgentTurnView.css";

export interface AgentTurnLabels {
  /** Selection chip; "{n}" is replaced with the character count. */
  selectionChip: string;
}

export function AgentTurnView({
  turn,
  labels,
}: {
  turn: AgentTurn;
  labels: AgentTurnLabels;
}) {
  switch (turn.kind) {
    case "User":
      return (
        <UserMessage
          text={turn.text}
          images={turn.images ?? []}
          labels={labels}
        />
      );
    case "Assistant":
      return (
        <div className="agent-message agent-message-assistant">
          <MarkdownText text={turn.text} />
        </div>
      );
    case "ToolCall":
      return (
        <div className="agent-tool-line">
          <SearchIcon className="agent-tool-icon" />
          {turn.name}
        </div>
      );
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

/**
 * The user's own turn: their prose, with the selection and attachments that
 * rode along shown as chips rather than as the raw tagged blocks. The
 * selection chip expands - it's context the user chose, so it should be
 * checkable, just not occupying the transcript by default.
 */
function UserMessage({
  text,
  images,
  labels,
}: {
  text: string;
  images: ImageAttachment[];
  labels: AgentTurnLabels;
}) {
  const { body, selection, attachments } = parseUserMessage(text);
  const [expanded, setExpanded] = useState(false);
  // Text attachments are recovered by re-parsing the <attached-file> blocks
  // out of the prompt; images never had one to parse (they travel as provider
  // image parts, not as text), so they come straight off the turn. Without
  // this a message with a picture attached showed no chip at all.
  const attachmentNames = [
    ...attachments,
    ...images.map((image) => image.name),
  ];

  return (
    <div className="agent-message agent-message-user">
      {(selection !== null || attachmentNames.length > 0) && (
        <div className="agent-message-context">
          {selection !== null && (
            <button
              type="button"
              className="agent-context-chip"
              aria-expanded={expanded}
              onClick={() => setExpanded((prev) => !prev)}
            >
              <ChevronIcon
                className={`agent-context-chip-caret ${
                  expanded ? "agent-context-chip-caret-open" : ""
                }`}
              />
              {labels.selectionChip.replace(
                "{n}",
                String([...selection].length),
              )}
            </button>
          )}
          {attachmentNames.map((name, i) => (
            <span className="agent-context-chip" key={`${name}-${i}`}>
              <PaperclipIcon />
              {name}
            </span>
          ))}
        </div>
      )}
      {selection !== null && expanded && (
        <pre className="agent-message-selection">{selection}</pre>
      )}
      {body && <div className="agent-message-body">{body}</div>}
    </div>
  );
}
