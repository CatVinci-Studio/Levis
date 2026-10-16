import { describe, expect, it } from "vitest";
import { commentParts } from "./raw-html-preview-plugin";

const body = (text: string) => {
  const parts = commentParts(text);
  return parts && text.slice(parts.bodyFrom, parts.bodyTo);
};

describe("an HTML comment in the text", () => {
  it("reads as its words, without the markers or the blank lines in them", () => {
    expect(body("<!-- Facts to keep. -->")).toBe("Facts to keep.");
    expect(body("<!--\nWriting instructions.\n\nMore.\n-->\n")).toBe(
      "Writing instructions.\n\nMore.",
    );
    expect(body("<!---->")).toBe("");
  });

  it("is only a whole comment, never markup around or between two", () => {
    expect(commentParts("<b>bold</b>")).toBeNull();
    expect(commentParts("<!-- a --> <b>x</b> <!-- b -->")).toBeNull();
    expect(commentParts("<!-- unclosed")).toBeNull();
  });
});
