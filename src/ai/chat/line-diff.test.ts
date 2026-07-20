import { describe, expect, it } from "vitest";
import { diffLines } from "./line-diff";

const render = (before: string, after: string) =>
  diffLines(before, after).map(
    (l) =>
      `${l.kind === "add" ? "+" : l.kind === "remove" ? "-" : " "}${l.text}`,
  );

describe("diffLines", () => {
  it("keeps unchanged lines as context", () => {
    expect(render("a\nb\nc", "a\nB\nc")).toEqual([" a", "-b", "+B", " c"]);
  });

  it("reports a pure insertion without touching its neighbours", () => {
    expect(render("a\nc", "a\nb\nc")).toEqual([" a", "+b", " c"]);
  });

  it("reports a pure deletion", () => {
    expect(render("a\nb\nc", "a\nc")).toEqual([" a", "-b", " c"]);
  });

  it("treats an empty before as all additions", () => {
    expect(render("", "x\ny")).toEqual(["+x", "+y"]);
  });

  it("treats an empty after as all removals", () => {
    expect(render("x\ny", "")).toEqual(["-x", "-y"]);
  });

  it("is empty when both sides are", () => {
    expect(diffLines("", "")).toEqual([]);
  });

  it("keeps markdown syntax visible on both sides", () => {
    expect(render("## Old\n\ntext", "## New\n\ntext")).toEqual([
      "-## Old",
      "+## New",
      " ",
      " text",
    ]);
  });

  it("falls back to remove-all/add-all past the LCS cap", () => {
    const before = Array.from({ length: 401 }, (_, i) => `a${i}`).join("\n");
    const after = Array.from({ length: 401 }, (_, i) => `b${i}`).join("\n");
    const out = diffLines(before, after);
    expect(out).toHaveLength(802);
    expect(out[0].kind).toBe("remove");
    expect(out[801].kind).toBe("add");
  });
});
