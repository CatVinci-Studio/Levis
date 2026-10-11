import { describe, expect, it } from "vitest";
import { previewText } from "./DocumentList";

describe("previewText", () => {
  it("drops front matter and Markdown syntax but keeps the words", () => {
    const md = [
      "---",
      "title: Notes",
      "---",
      "# Spring *trip*",
      "",
      "> A **quiet** start",
      "- pack [maps](https://x.test)",
      "1. book `train`",
    ].join("\n");
    expect(previewText(md)).toBe(
      "Spring trip\n\nA quiet start\npack maps\nbook train",
    );
  });

  it("unescapes what the serializer escaped and drops empty markers", () => {
    expect(previewText("Spring\\_trip\\_plan\n\n>\n> - nested")).toBe(
      "Spring_trip_plan\n\n\nnested",
    );
  });

  it("keeps only the opening of a long document", () => {
    const md = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    expect(previewText(md).split("\n")).toHaveLength(24);
  });
});
