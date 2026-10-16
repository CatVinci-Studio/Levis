import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import {
  isOneLineBlock,
  nextWordChunk,
  splitCandidates,
  stripEcho,
  tidySuggestion,
} from "./ghost-text-plugin";

describe("stripEcho", () => {
  it("drops a repeated tail of the before-text", () => {
    expect(stripEcho("The results show", "results show that it works")).toBe(
      " that it works",
    );
    expect(stripEcho("实验结果表明", "实验结果表明，该方法有效")).toBe(
      "，该方法有效",
    );
  });
  it("leaves short, ordinary overlaps alone", () => {
    expect(stripEcho("we saw the ", "the cat")).toBe("the cat");
    expect(stripEcho("Hello", " world")).toBe(" world");
  });
});

describe("nextWordChunk", () => {
  it("takes one word with its leading space", () => {
    expect(nextWordChunk(" quickly ballooned past")).toBe(" quickly");
    expect(nextWordChunk("ballooned.")).toBe("ballooned.");
  });
  it("takes up to two CJK characters plus trailing punctuation", () => {
    expect(nextWordChunk("应当先听取")).toBe("应当");
    expect(nextWordChunk("先，听取")).toBe("先，");
  });
});

describe("splitCandidates", () => {
  it("splits on the separator line and drops empties", () => {
    expect(splitCandidates("one\n<<<>>>\ntwo\n<<<>>>\n")).toEqual([
      "one",
      "two",
    ]);
    expect(splitCandidates("just one")).toEqual(["just one"]);
    expect(splitCandidates("one\n\n<<<>>>\n\ntwo")).toEqual(["one", "two"]);
  });
  it("cuts a separator that isn't on a line of its own", () => {
    expect(splitCandidates(" <<<>>>\n")).toEqual([]);
    expect(splitCandidates("<<<>>>\n slowed")).toEqual([" slowed"]);
    expect(splitCandidates(" grew <<<>>>\n slowed")).toEqual([
      " grew",
      " slowed",
    ]);
  });
  it("keeps each candidate's joining space", () => {
    expect(splitCandidates(" grew\n<<<>>>\n slowed\n<<<>>>\n stalled")).toEqual(
      [" grew", " slowed", " stalled"],
    );
  });
});

describe("one-line blocks", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "text*" },
      heading: { group: "block", content: "text*" },
      table: { group: "block", content: "row+", tableRole: "table" },
      row: { content: "cell+", tableRole: "row" },
      cell: { content: "paragraph", tableRole: "cell" },
      text: {},
    },
  });
  const p = (t: string) => schema.node("paragraph", null, schema.text(t));
  const doc = schema.node("doc", null, [
    p("prose"),
    schema.node("heading", null, schema.text("Title")),
    schema.node("table", null, [
      schema.node("row", null, [schema.node("cell", null, [p("cell")])]),
    ]),
  ]);

  it("knows a table cell and a heading from a paragraph", () => {
    expect(isOneLineBlock(doc, 3)).toBe(false);
    expect(isOneLineBlock(doc, 10)).toBe(true);
    expect(isOneLineBlock(doc, 19)).toBe(true);
  });

  it("joins a suggestion's lines there, and only there", () => {
    expect(tidySuggestion("Act", " walks.\n\nThen leaves.\n", true)).toBe(
      " walks. Then leaves.",
    );
    expect(tidySuggestion("Act", " walks.\n\nThen leaves.")).toBe(
      " walks.\n\nThen leaves.",
    );
  });
});
