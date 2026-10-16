import { describe, expect, it } from "vitest";
import { alignPrefixOffset } from "./mode-switch";

describe("alignPrefixOffset", () => {
  it("finds where the serialized prefix ends in the file's text", () => {
    const markdown = "# T\n\nfirst para\n\nsecond para here";
    expect(alignPrefixOffset("# T\n\nfirst para\n\nsecond", markdown)).toBe(
      markdown.indexOf("second") + "second".length,
    );
  });

  it("survives the file spelling emphasis differently", () => {
    // Serialized as _x_, written in the file as *x*.
    const markdown = "Intro *some* words then the caret spot here";
    const prefix = "Intro _some_ words then the caret";
    expect(alignPrefixOffset(prefix, markdown)).toBe(markdown.indexOf(" spot"));
  });

  it("never runs past the end of the text", () => {
    expect(alignPrefixOffset("abc\n\n", "ab")).toBeLessThanOrEqual(2);
  });
});
