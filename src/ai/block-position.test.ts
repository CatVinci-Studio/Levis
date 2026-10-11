import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { blockPositionAfter } from "./useInlineChat";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: {},
  },
});
const p = (text: string) => schema.node("paragraph", null, [schema.text(text)]);
// Positions: <p>one</p> = 0..5, <p>two</p> = 5..10, <p>three</p> = 10..17.
const doc = schema.node("doc", null, [p("one"), p("two"), p("three")]);

describe("blockPositionAfter", () => {
  it("is the end of the block a position sits in", () => {
    expect(blockPositionAfter(doc, 2)).toBe(5);
    expect(blockPositionAfter(doc, 7)).toBe(10);
  });

  it("is the end of the block that starts at a boundary, not the document's", () => {
    expect(blockPositionAfter(doc, 5)).toBe(10);
    expect(blockPositionAfter(doc, 0)).toBe(5);
    expect(blockPositionAfter(doc, doc.content.size)).toBe(doc.content.size);
  });
});
