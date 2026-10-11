import { describe, expect, it } from "vitest";
import {
  composeSentences,
  diffSentences,
  splitSentences,
} from "./sentence-diff";

describe("splitSentences", () => {
  it("splits CJK and Latin text without losing a character", () => {
    const zh = "第一句。第二句！“第三句？”最后";
    expect(splitSentences(zh)).toEqual([
      "第一句。",
      "第二句！",
      "“第三句？”",
      "最后",
    ]);
    const en = "One. Two is here! Three?";
    expect(splitSentences(en).join("")).toBe(en);
    expect(splitSentences(en)).toHaveLength(3);
  });
});

describe("diffSentences + composeSentences", () => {
  const before = "我们花了整整两个月。访谈了四十六位居民。内容涵盖很多方面。";
  const after = "历时两个月。访谈了四十六位居民。内容涉及看法与担忧。";
  const hunks = diffSentences(before, after);

  it("finds the changed sentences around the unchanged one", () => {
    expect(hunks.filter((h) => h.kind === "change")).toHaveLength(2);
    expect(hunks[1]).toEqual({ kind: "same", text: "访谈了四十六位居民。" });
  });

  it("takes all, none, or some of the changes", () => {
    expect(composeSentences(hunks, [true, true])).toBe(after);
    expect(composeSentences(hunks, [false, false])).toBe(before);
    expect(composeSentences(hunks, [true, false])).toBe(
      "历时两个月。访谈了四十六位居民。内容涵盖很多方面。",
    );
  });
});
