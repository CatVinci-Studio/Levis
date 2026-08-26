import { describe, expect, it } from "vitest";
import {
  imageStemForMode,
  readImagePresentation,
  safeImageStem,
  writeImageWidth,
} from "./image-plugin";

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

describe("image width metadata", () => {
  it("reads a saved width without exposing it as the image tooltip", () => {
    expect(readImagePresentation("Product shot {levis-width=70%}")).toEqual({
      title: "Product shot",
      widthPercent: 70,
    });
  });

  it("updates the width while preserving a regular Markdown title", () => {
    expect(writeImageWidth("Product shot {levis-width=50%}", 70)).toBe(
      "Product shot {levis-width=70%}",
    );
  });

  it("can restore automatic sizing and remove metadata-only titles", () => {
    expect(writeImageWidth("{levis-width=50%}", null)).toBeNull();
    expect(writeImageWidth("Product shot {levis-width=50%}", null)).toBe(
      "Product shot",
    );
  });
});
