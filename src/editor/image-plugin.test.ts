import { describe, expect, it } from "vitest";
import { imageStemForMode, safeImageStem } from "./image-plugin";

describe("image upload filenames", () => {
  it("keeps a safe original filename without its extension", () => {
    const file = new File(["image"], "Product screenshot.png", {
      type: "image/png",
    });
    expect(imageStemForMode(file, "original")).toBe("Product screenshot");
  });

  it("removes path and platform-reserved filename characters", () => {
    expect(safeImageStem("  launch</>page:*?  .png")).toBe("launch---page---");
  });

  it("falls back when the name has no usable stem", () => {
    expect(safeImageStem("...png")).toBe("image");
  });

  it("creates a collision-resistant automatic name", () => {
    const file = new File(["image"], "image.png", { type: "image/png" });
    expect(imageStemForMode(file, "auto")).toMatch(/^\d{8}-\d{6}-[a-z0-9]{4}$/);
  });
});
