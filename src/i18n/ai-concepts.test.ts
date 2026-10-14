import { describe, expect, it } from "vitest";
import { AI_NAME, strings } from "./strings";

// The copy for the concepts in docs/AI-CONCEPTS.md: the starter files and
// the names the user meets in Settings and the project bar.

/** What the backend sends the model from an agent.md: everything outside
 *  `<!-- -->` comments (src-tauri ai::workspace::strip_html_comments). */
function sentToModel(text: string): string {
  return text.replace(/<!--[\s\S]*?(-->|$)/g, "").trim();
}

describe.each(["en", "zh", "ja"] as const)("AI concept copy in %s", (lang) => {
  const t = strings[lang];

  it("the agent.md starters teach in comments and send nothing", () => {
    expect(sentToModel(t.agentInstructionsTemplate)).toBe("");
    expect(sentToModel(t.projectInstructionsTemplate)).toBe("");
    // A library entry's how-to is a comment too, so an untouched entry
    // carries no facts.
    const entry = t.projectLibraryTemplate.replace(/\{name\}/g, "Lin Wan");
    expect(sentToModel(entry.replace(/^---[\s\S]*?\n---/, ""))).toBe("");
  });

  it("the starter files name the menu items exactly as the menus do", () => {
    expect(t.projectStyleTemplate).toContain(t.projectLearnStyle);
    expect(t.agentInstructionsTemplate).toContain(t.projectEditInstructions);
    for (const template of [
      t.agentInstructionsTemplate,
      t.projectInstructionsTemplate,
      t.projectStyleTemplate,
      t.projectLibraryTemplate,
    ])
      expect(template).toContain(AI_NAME);
  });

  it("Settings and the project bar give the same choice the same words", () => {
    // Both "go back to the default" buttons are one string.
    expect(Object.keys(t)).not.toContain("agentWorkspaceRootReset");
    // The Settings row is named after the project folder the menu picks.
    expect(t.projectPickFolder.toLowerCase()).toContain(
      t.agentWorkspaceRootLabel.toLowerCase(),
    );
  });
});
