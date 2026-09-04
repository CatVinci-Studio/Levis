// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { comboFromEvent, formatCombo, isBindableCombo } from "./shortcuts";
afterEach(() => vi.restoreAllMocks());
const os = (platform: string) =>
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
const combo = (key: string, init: KeyboardEventInit) =>
  comboFromEvent(new KeyboardEvent("keydown", { key, ...init }));
describe("platform shortcuts", () => {
  it("distinguishes Control from Command on macOS", () => {
    os("MacIntel");
    expect(combo("f", { metaKey: true })).toBe("mod+f");
    expect(combo("f", { ctrlKey: true })).toBe("ctrl+f");
    expect(combo("f", { ctrlKey: true, metaKey: true })).toBe("mod+ctrl+f");
    expect(formatCombo("ctrl+f")).toBe("⌃F");
  });
  it.each(["Win32", "Linux x86_64"])("uses Control on %s", (platform) => {
    os(platform);
    expect(combo("f", { ctrlKey: true })).toBe("mod+f");
    expect(combo("f", { metaKey: true })).toBe("meta+f");
    expect(formatCombo("mod+shift+f")).toBe("Ctrl+Shift+F");
  });
  it("does not capture IME or AltGr typing", () => {
    expect(combo("s", { ctrlKey: true, isComposing: true })).toBeNull();
    const e = new KeyboardEvent("keydown", {
      key: "@",
      ctrlKey: true,
      altKey: true,
    });
    vi.spyOn(e, "getModifierState").mockImplementation(
      (key) => key === "AltGraph",
    );
    expect(comboFromEvent(e)).toBeNull();
  });
  it("does not allow normal shifted typing as an app shortcut", () => {
    expect(isBindableCombo("shift+a")).toBe(false);
    expect(isBindableCombo("mod+shift+a")).toBe(true);
    expect(isBindableCombo("ctrl+a")).toBe(true);
  });
});
