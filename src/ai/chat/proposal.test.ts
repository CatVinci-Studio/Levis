import { describe, expect, it } from "vitest";
import { resolveSkillMessage } from "./proposal";

const skills = [
  { name: "tighten", description: "Tighten prose", prompt: "Cut filler." },
];

describe("resolveSkillMessage", () => {
  it("expands /name into the skill's prompt, marked as already loaded", () => {
    expect(resolveSkillMessage("/tighten the Method paragraph", skills)).toBe(
      '<skill name="tighten">\nCut filler.\n</skill>\n\nthe Method paragraph',
    );
    expect(resolveSkillMessage("/tighten", skills)).toBe(
      '<skill name="tighten">\nCut filler.\n</skill>',
    );
  });

  it("leaves other messages alone", () => {
    expect(resolveSkillMessage("/unknown thing", skills)).toBe(
      "/unknown thing",
    );
    expect(resolveSkillMessage("tighten this", skills)).toBe("tighten this");
  });
});
