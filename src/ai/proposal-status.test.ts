import { describe, expect, it } from "vitest";
import { annotateProposalStatuses } from "./proposal-status";
import type { AgentTurn } from "./types";

const history: AgentTurn[] = [
  { kind: "User", text: "tighten the intro" },
  {
    kind: "ToolCall",
    call_id: "call-1",
    name: "propose_edit",
    arguments: '{"action":"replace","anchor":"a","text":"b"}',
  },
  { kind: "ToolResult", call_id: "call-1", output: "Edit proposed." },
  { kind: "Assistant", text: "Tightened the intro." },
];

describe("annotateProposalStatuses", () => {
  it("appends the current status to a known proposal's tool result", () => {
    const out = annotateProposalStatuses(history, { "call-1": "pending" });
    const result = out[2];
    if (result.kind !== "ToolResult") throw new Error("turn order changed");
    expect(result.output).toContain("Edit proposed.");
    expect(result.output).toContain("NOT yet accepted or rejected");
  });

  it("distinguishes accepted from rejected", () => {
    const accepted = annotateProposalStatuses(history, {
      "call-1": "accepted",
    });
    const rejected = annotateProposalStatuses(history, {
      "call-1": "rejected",
    });
    expect((accepted[2] as { output: string }).output).toContain("accepted");
    expect((rejected[2] as { output: string }).output).toContain("rejected");
  });

  it("leaves tool results absent from the status map untouched", () => {
    const out = annotateProposalStatuses(history, { "other-call": "pending" });
    expect(out[2]).toBe(history[2]);
  });

  it("returns the history unchanged when there are no statuses", () => {
    expect(annotateProposalStatuses(history, {})).toBe(history);
  });

  it("never rewrites the stored turns themselves", () => {
    const before = (history[2] as { output: string }).output;
    annotateProposalStatuses(history, { "call-1": "invalid" });
    expect((history[2] as { output: string }).output).toBe(before);
  });
});
