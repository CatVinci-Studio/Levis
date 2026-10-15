import { describe, expect, it } from "vitest";
import { grammarKind } from "./grammar-kind";

describe("grammarKind", () => {
  it.each([
    ["必竟", "毕竟", undefined, "spelling"],
    ["qeustion", "question", undefined, "spelling"],
    ["recieve", "receive", undefined, "spelling"],
    ["他们,", "他们，", undefined, "punctuation"],
    ["he go", "he goes", undefined, "grammar"],
    ["跑的很快", "跑得很快", undefined, "grammar"],
    ["因为下雨所以我们", "我们因为下雨", undefined, "grammar"],
    ["informations", "information", undefined, "spelling"],
    ["a apple", "an apple", undefined, "grammar"],
    ["x", "y", "zh.punct.halfwidth", "rules"],
  ])("%s → %s is %s", (original, suggestion, rule, kind) => {
    expect(grammarKind(original, suggestion, rule)).toBe(kind);
  });
});
