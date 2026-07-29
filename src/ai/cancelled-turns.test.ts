import { describe, expect, it } from "vitest";
import { keepCancelledTurns, STOPPED_TOOL_RESULT } from "./cancelled-turns";
import type { AgentTurn } from "./types";

const user: AgentTurn = { kind: "User", text: "continue the draft" };

describe("keepCancelledTurns", () => {
  it("drops an exchange stopped before anything streamed", () => {
    expect(keepCancelledTurns([user], "")).toEqual([]);
    expect(keepCancelledTurns([user], "   ")).toEqual([]);
  });

  it("keeps the partial reply as a final assistant turn", () => {
    expect(keepCancelledTurns([user], "The story then")).toEqual([
      user,
      { kind: "Assistant", text: "The story then" },
    ]);
  });

  it("keeps completed tool turns as they are", () => {
    const call: AgentTurn = {
      kind: "ToolCall",
      call_id: "c1",
      name: "propose_edit",
      arguments: "{}",
    };
    const result: AgentTurn = {
      kind: "ToolResult",
      call_id: "c1",
      output: "Edit proposed.",
    };
    expect(keepCancelledTurns([user, call, result], "")).toEqual([
      user,
      call,
      result,
    ]);
  });

  it("closes a tool call the stop left unanswered", () => {
    const call: AgentTurn = {
      kind: "ToolCall",
      call_id: "c1",
      name: "search_document",
      arguments: "{}",
    };
    expect(keepCancelledTurns([user, call], "half a sen")).toEqual([
      user,
      call,
      { kind: "ToolResult", call_id: "c1", output: STOPPED_TOOL_RESULT },
      { kind: "Assistant", text: "half a sen" },
    ]);
  });
});
