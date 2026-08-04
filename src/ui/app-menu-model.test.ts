// @vitest-environment jsdom
//
// Only formatCombo needs it - it reads navigator to decide between "⌘" and
// "Ctrl". Node 21+ happens to define a global navigator, so without this the
// file passes locally on a current Node and fails on CI's Node 20.

import { describe, expect, it } from "vitest";
import type { Shortcuts } from "../settings/SettingsContext";
import type { Strings } from "../i18n/strings";
import { strings } from "../i18n/strings";
import { formatCombo } from "../utils/shortcuts";
import { buildAppMenu, type MenuNode } from "./app-menu-model";

/**
 * The app-drawn menu is the ONLY menu Windows users see, so the combos it
 * advertises are the app's shortcut documentation on that platform. They are
 * pinned here because they diverge from the macOS ones on purpose: the macOS
 * combos live in src-tauri/src/menu.rs and read naturally as "CmdOrCtrl+X",
 * which is exactly the shape that would quietly drag a Windows-wrong combo
 * (Ctrl+Q for Exit, Ctrl+T for New Window) back in.
 *
 * Asserted against the stored combo strings rather than formatCombo's output
 * so the expectations don't depend on which platform runs the suite.
 */

const t = strings.en as Strings;

const shortcuts: Shortcuts = {
  triggerCompletion: "mod+shift+space",
  triggerGrammarCheck: "mod+shift+g",
  toggleFloatingChat: "mod+shift+k",
  toggleSidebar: "mod+\\",
  toggleSourceMode: "mod+/",
  toggleTypewriterMode: "",
  findReplace: "mod+f",
};

/** Every entry in the tree, submenus included. */
function flatten(nodes: MenuNode[]): Exclude<MenuNode, "separator">[] {
  return nodes.flatMap((node) =>
    node === "separator"
      ? []
      : [node, ...(node.submenu ? flatten(node.submenu) : [])],
  );
}

const entries = flatten(buildAppMenu(t, shortcuts, []));

function accelOf(label: string): string | undefined {
  const found = entries.find((entry) => entry.label === label);
  expect(found, `no menu entry labelled "${label}"`).toBeDefined();
  return found?.accel;
}

describe("the Windows app menu", () => {
  it("offers Alt+F4 for Exit, not Ctrl+Q", () => {
    // Ctrl+Q closes nothing on Windows, and menu.rs no longer registers it
    // there - advertising it would be a hint for a dead combo.
    expect(accelOf(t.menuExit)).toBe("alt+f4");
    expect(entries.map((entry) => entry.accel)).not.toContain("mod+q");
  });

  it("opens a new window with Ctrl+Shift+N, leaving Ctrl+T alone", () => {
    // Ctrl+T reads as "new tab" on Windows and this app has tabs.
    expect(accelOf(t.menuNewWindow)).toBe("mod+shift+n");
    expect(entries.map((entry) => entry.accel)).not.toContain("mod+t");
    // Still distinct from New File, which keeps the plain Ctrl+N.
    expect(accelOf(t.menuNewFile)).toBe("mod+n");
  });

  it("shows Ctrl+Y for Redo", () => {
    // Milkdown's history keymap binds both Mod-y and Shift-Mod-z; Windows
    // advertises the former.
    expect(accelOf(t.menuRedo)).toBe("mod+y");
  });

  it("advertises F11 for fullscreen", () => {
    // Bound in App.tsx's keydown handler - there is no native item to hang
    // an accelerator on, so this hint and that handler are the whole story.
    expect(accelOf(t.menuFullscreen)).toBe("f11");
  });

  it("renders function-key combos through formatCombo intact", () => {
    // "f11"/"f4" have no KEY_LABELS entry and fall through to toUpperCase -
    // the one step between the combos above and what the user reads.
    expect(formatCombo("f11")).toBe("F11");
    expect(formatCombo("alt+f4")).toContain("F4");
  });
});
