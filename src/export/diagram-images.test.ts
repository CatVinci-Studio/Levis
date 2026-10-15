import { describe, expect, it } from "vitest";
import { replaceMermaidBlocks } from "./diagram-images";

const draw = async (code: string) =>
  code.includes("broken")
    ? null
    : { dataUrl: `data:x,${code.length}`, width: 640.4 };

describe("replaceMermaidBlocks", () => {
  it("turns each mermaid block into an image and keeps other code", async () => {
    const md = [
      "# T",
      "```mermaid",
      "graph LR",
      "  A --> B",
      "```",
      "```js",
      "const a = 1;",
      "```",
      "~~~mermaid",
      "broken",
      "~~~",
    ].join("\n");
    expect(await replaceMermaidBlocks(md, draw)).toBe(
      [
        "# T",
        "![](data:x,18){width=640px}",
        "```js",
        "const a = 1;",
        "```",
        "~~~mermaid",
        "broken",
        "~~~",
      ].join("\n"),
    );
  });

  it("leaves an unclosed block as source", async () => {
    const md = "```mermaid\ngraph LR";
    expect(await replaceMermaidBlocks(md, draw)).toBe(md);
  });

  it("keeps the source when drawing throws", async () => {
    const md = "```mermaid\ngraph LR\n```";
    expect(
      await replaceMermaidBlocks(md, () => Promise.reject(new Error("x"))),
    ).toBe(md);
  });
});
