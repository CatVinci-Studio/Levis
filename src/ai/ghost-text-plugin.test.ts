import { describe, expect, it } from "vitest";
import { nextWordChunk, splitCandidates, stripEcho } from "./ghost-text-plugin";

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
  it("keeps each candidate's joining space", () => {
    expect(splitCandidates(" grew\n<<<>>>\n slowed\n<<<>>>\n stalled")).toEqual(
      [" grew", " slowed", " stalled"],
    );
  });
});
