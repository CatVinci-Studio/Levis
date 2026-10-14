import { describe, expect, it } from "vitest";
import { sheetRestingPlace } from "./agent-panel";

describe("where the AI sheet settles", () => {
  const full = 800;
  it("goes to the nearest stop after a slow drag", () => {
    expect(sheetRestingPlace(700, full, 0)).toBe("full");
    expect(sheetRestingPlace(450, full, 0)).toBe("half");
    expect(sheetRestingPlace(200, full, 0)).toBe("closed");
  });
  it("follows the direction of a flick", () => {
    expect(sheetRestingPlace(300, full, -1)).toBe("full");
    expect(sheetRestingPlace(700, full, 1)).toBe("half");
    expect(sheetRestingPlace(450, full, 1)).toBe("closed");
  });
});
