import { describe, expect, it } from "vitest";
import { strings, type Strings } from "../i18n/strings";
import { createTutorialMockAgent } from "./tutorial-mock-agent";

// Only the keys the mock agent reads - the zh prompt is the interesting one
// because its curly quotes are easy to drop or replace when retyped.
const t = {
  tutorialAgentChatMockReply: "chat reply",
  tutorialAgentEditMockReply: "edit reply",
  tutorialAgentEditPrompt: "把“这是一段普通的文字”改简洁",
  tutorialAgentEditTarget: "这是一段普通的文字。",
  tutorialAgentEditSuggestion: "这是一段文字。",
} as Strings;

function isProposal(
  reply: ReturnType<ReturnType<typeof createTutorialMockAgent>>,
) {
  return Array.isArray(reply) && reply[0]?.kind === "ToolCall";
}

describe("createTutorialMockAgent", () => {
  const agent = createTutorialMockAgent(t);

  it("returns prose for an ordinary question", () => {
    expect(agent("这个软件怎么用？")).toBe(t.tutorialAgentChatMockReply);
  });

  it("matches the exact displayed prompt", () => {
    expect(isProposal(agent(t.tutorialAgentEditPrompt))).toBe(true);
  });

  it("tolerates retyped punctuation: straight or missing quotes", () => {
    expect(isProposal(agent('把"这是一段普通的文字"改简洁'))).toBe(true);
    expect(isProposal(agent("把这是一段普通的文字改简洁。"))).toBe(true);
  });

  it("still matches with the selected-text wrapper and extra whitespace", () => {
    const wrapped = `<selected-text>\n这是一段普通的文字。\n</selected-text>\n\n把 这是一段普通的文字 改简洁`;
    expect(isProposal(agent(wrapped))).toBe(true);
  });
  it.each(["zh", "en", "ja"] as const)(
    "uses the displayed editing example in %s",
    (lang) => {
      const copy = strings[lang];
      const reply = createTutorialMockAgent(copy)(copy.tutorialAgentEditPrompt);
      expect(Array.isArray(reply)).toBe(true);
      if (!Array.isArray(reply) || reply[0]?.kind !== "ToolCall")
        throw new Error("Missing edit preview");
      const args = JSON.parse(reply[0].arguments);
      expect(args.anchor).toBe(copy.tutorialAgentEditTarget);
      expect(args.text).toBe(copy.tutorialAgentEditSuggestion);
      expect(args.text.length).toBeLessThan(args.anchor.length);
    },
  );
});
