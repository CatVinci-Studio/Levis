import { describe, expect, it } from "vitest";
import {
  anchorGrammarIssues,
  evaluateMarkdownTasks,
  isTutorialPracticeComplete,
  MARKDOWN_ALL_TASKS,
  MARKDOWN_TASK,
} from "./tutorial-evaluation";

describe("evaluateMarkdownTasks", () => {
  it("detects every exercise independently", () => {
    expect(evaluateMarkdownTasks("# Heading")).toBe(MARKDOWN_TASK.heading);
    expect(evaluateMarkdownTasks("## Heading")).toBe(MARKDOWN_TASK.subheading);
    expect(evaluateMarkdownTasks("**important**")).toBe(MARKDOWN_TASK.bold);
    expect(evaluateMarkdownTasks("*important*")).toBe(MARKDOWN_TASK.italic);
    expect(evaluateMarkdownTasks("==important==")).toBe(
      MARKDOWN_TASK.highlight,
    );
    expect(evaluateMarkdownTasks("`detail`")).toBe(MARKDOWN_TASK.code);
    expect(evaluateMarkdownTasks("$E=mc^2$")).toBe(MARKDOWN_TASK.formula);
  });

  it("combines tasks regardless of their order", () => {
    const page =
      "$E=mc^2$\n`detail`\n==highlight==\n*italic*\n**bold**\n## Subheading\n# Heading";
    expect(evaluateMarkdownTasks(page)).toBe(MARKDOWN_ALL_TASKS);
  });

  it("does not accept empty delimiters or a hash without heading text", () => {
    expect(evaluateMarkdownTasks("#\n##\n****\n**\n====\n``\n$$")).toBe(0);
  });
});

describe("anchorGrammarIssues", () => {
  const target = "He go to school every day";
  const issue = {
    start: 3,
    end: 5,
    issue: "verb agreement",
    suggestion: "goes",
    original: "go",
  };

  it("keeps offsets untouched when the sentence is the whole paragraph", () => {
    expect(anchorGrammarIssues(target, { target, issues: [issue] })).toEqual([
      issue,
    ]);
  });

  it("shifts offsets when the sentence follows earlier paragraph text", () => {
    const [anchored] = anchorGrammarIssues(`Earlier words. ${target}`, {
      target,
      issues: [issue],
    });
    expect(anchored.start).toBe(15 + 3);
    expect(anchored.end).toBe(15 + 5);
  });

  it("counts the prefix in Unicode scalars, not UTF-16 units", () => {
    const [anchored] = anchorGrammarIssues(`🎉🎉 ${target}`, {
      target,
      issues: [issue],
    });
    // Two emoji (one scalar each, two UTF-16 units each) plus a space.
    expect(anchored.start).toBe(3 + 3);
  });
});

describe("isTutorialPracticeComplete", () => {
  it("keeps each interactive lesson locked until its real success phase", () => {
    expect(isTutorialPracticeComplete("markdownPractice", 126)).toBe(false);
    expect(isTutorialPracticeComplete("markdownPractice", 127)).toBe(true);
    expect(isTutorialPracticeComplete("completion", 1)).toBe(false);
    expect(isTutorialPracticeComplete("completion", 2)).toBe(true);
    expect(isTutorialPracticeComplete("grammar", 2)).toBe(true);
    expect(isTutorialPracticeComplete("agentChat", 0)).toBe(false);
    expect(isTutorialPracticeComplete("agentChat", 1)).toBe(true);
    expect(isTutorialPracticeComplete("agentEdit", 2)).toBe(false);
    expect(isTutorialPracticeComplete("agentEdit", 3)).toBe(true);
  });
});
