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

describe("aligning a rewritten run", () => {
  it("keeps sentence decisions when a rewrite splits a sentence in two", () => {
    const before =
      "这一句其实是在呼应第一回的前世姻缘，可以说是全书爱情线的一个起点。宝玉初见黛玉便觉似曾相识，作者就某种意义而言是借这句话点明了木石前盟。贾母一句“胡说”，却把这层深意轻轻带过。";
    const after =
      "这一句呼应第一回的前世姻缘，是全书爱情线的起点。宝玉初见黛玉，便觉似曾相识。作者借这句话点明木石前盟。贾母一句“胡说”，把这层深意轻轻带过。";
    const changes = diffSentences(before, after).filter(
      (h) => h.kind === "change",
    );
    expect(changes).toHaveLength(3);
    expect(changes[1]).toEqual({
      kind: "change",
      before:
        "宝玉初见黛玉便觉似曾相识，作者就某种意义而言是借这句话点明了木石前盟。",
      after: "宝玉初见黛玉，便觉似曾相识。作者借这句话点明木石前盟。",
    });
    // Taking only the middle one composes cleanly.
    expect(
      composeSentences(diffSentences(before, after), [false, true, false]),
    ).toBe(
      "这一句其实是在呼应第一回的前世姻缘，可以说是全书爱情线的一个起点。宝玉初见黛玉，便觉似曾相识。作者借这句话点明木石前盟。贾母一句“胡说”，却把这层深意轻轻带过。",
    );
  });

  it("pairs English sentences joined into one", () => {
    const changes = diffSentences(
      "The study ran in three towns. It took two months. We met forty residents.",
      "The study ran in three towns over two months. We spoke with forty residents.",
    ).filter((h) => h.kind === "change");
    expect(changes.map((c) => c.kind === "change" && c.before)).toEqual([
      "The study ran in three towns. It took two months. ",
      "We met forty residents.",
    ]);
  });

  it("leaves a wholesale rewrite as one change", () => {
    expect(
      diffSentences(
        "Apples are red. Pears are green.",
        "Nothing here matches at all.",
      ).length,
    ).toBe(1);
  });
});
