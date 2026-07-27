import { describe, expect, it } from "vitest";
import { revealOffset } from "./useQuickAskReveal";

const view = { top: 0, bottom: 600 };
const MARGIN = 12;

describe("revealOffset", () => {
  it("leaves a panel that already fits alone", () => {
    expect(revealOffset({ top: 100, bottom: 300 }, view, MARGIN)).toBe(0);
  });

  it("scrolls down just enough to clear the panel's bottom edge", () => {
    // Opened on the last line: the panel runs 40px past the fold.
    expect(revealOffset({ top: 480, bottom: 640 }, view, MARGIN)).toBe(52);
  });

  it("follows the panel as it grows a pending bar", () => {
    // Same panel, 30px taller now that the accept/reject bar appeared.
    expect(revealOffset({ top: 440, bottom: 610 }, view, MARGIN)).toBe(22);
  });

  it("scrolls up for a panel above the viewport", () => {
    expect(revealOffset({ top: -40, bottom: 120 }, view, MARGIN)).toBe(-52);
  });

  it("shows the bottom of a panel taller than the viewport", () => {
    // The composer and the accept/reject bar are down there; the top of a
    // panel this tall has to give.
    expect(revealOffset({ top: -100, bottom: 700 }, view, MARGIN)).toBe(112);
  });
});
