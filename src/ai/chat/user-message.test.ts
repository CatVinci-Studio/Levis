import { describe, expect, it } from "vitest";
import { parseUserMessage } from "./user-message";

describe("parseUserMessage", () => {
  it("leaves a plain message alone", () => {
    expect(parseUserMessage("rewrite this")).toEqual({
      body: "rewrite this",
      selection: null,
      attachments: [],
    });
  });

  it("lifts the selection out of the body", () => {
    const parsed = parseUserMessage(
      "<selected-text>\n## Heading\n\nBody\n</selected-text>\n\nmake it shorter",
    );
    expect(parsed.body).toBe("make it shorter");
    expect(parsed.selection).toBe("## Heading\n\nBody");
  });

  it("collects attachment names and drops their content", () => {
    const parsed = parseUserMessage(
      '<attached-file name="notes.md">\nlots of text\n</attached-file>\n\n' +
        '<attached-file name="spec.md">\nmore\n</attached-file>\n\nsummarize these',
    );
    expect(parsed.attachments).toEqual(["notes.md", "spec.md"]);
    expect(parsed.body).toBe("summarize these");
  });

  it("handles a message carrying both", () => {
    const parsed = parseUserMessage(
      '<attached-file name="a.md">\nx\n</attached-file>\n\n' +
        "<selected-text>\npicked\n</selected-text>\n\ndo it",
    );
    expect(parsed).toEqual({
      body: "do it",
      selection: "picked",
      attachments: ["a.md"],
    });
  });

  it("keeps an empty body when the message was only context", () => {
    const parsed = parseUserMessage("<selected-text>\nonly\n</selected-text>");
    expect(parsed.body).toBe("");
    expect(parsed.selection).toBe("only");
  });
});
