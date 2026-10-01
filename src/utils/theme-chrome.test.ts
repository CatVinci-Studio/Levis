// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  chromePalette,
  contrast,
  clearThemeChrome,
  themeColumnWidth,
} from "./theme-chrome";
const parse = (s: string) =>
  s.match(/\d+/g)!.map(Number) as [number, number, number];
describe("imported theme chrome", () => {
  it.each([
    [
      [244, 237, 223],
      [64, 59, 50],
      [146, 101, 60],
    ],
    [
      [24, 38, 34],
      [223, 235, 228],
      [120, 193, 160],
    ],
    [
      [255, 255, 255],
      [250, 250, 250],
      [255, 255, 0],
    ],
    [
      [0, 0, 0],
      [5, 5, 5],
      [0, 0, 80],
    ],
  ] as const)(
    "keeps readable controls for palette %j",
    (background, text, accent) => {
      const p = chromePalette(background, text, accent);
      expect(parse(p["--bg"])).toEqual(background);
      for (const key of [
        "--chrome-text",
        "--chrome-muted",
        "--chrome-accent",
        "--danger",
        "--success-color",
      ] as const) {
        expect(contrast(parse(p[key]), background)).toBeGreaterThanOrEqual(
          4.45,
        );
      }
      expect(
        contrast(parse(p["--chrome-primary"]), [255, 255, 255]),
      ).toBeGreaterThanOrEqual(4.45);
      expect(
        contrast(
          parse(p["--sidebar-active-text"]),
          parse(p["--sidebar-active"]),
        ),
      ).toBeGreaterThanOrEqual(4.45);
    },
  );
  it("clears only the derived stylesheet when returning to a built-in theme", () => {
    document.head.innerHTML =
      '<style id="levis-imported-chrome"></style><style id="levis-custom-theme"></style>';
    clearThemeChrome();
    expect(document.getElementById("levis-imported-chrome")).toBeNull();
    expect(document.getElementById("levis-custom-theme")).not.toBeNull();
    document.getElementById("levis-custom-theme")?.remove();
  });
});

describe("themeColumnWidth", () => {
  it("gives a theme's #write max-width the column it asked for", () => {
    expect(themeColumnWidth("1200px")).toBe("calc(1200px + 3rem)");
  });

  it("lets a percentage width span the pane", () => {
    expect(themeColumnWidth("80%")).toBe("100%");
  });

  it("leaves the column alone when the theme sets no width", () => {
    expect(themeColumnWidth("none")).toBeNull();
    expect(themeColumnWidth("")).toBeNull();
  });
});
