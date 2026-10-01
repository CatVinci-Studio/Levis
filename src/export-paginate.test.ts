// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { paginateDocument } from "./export-paginate";

// jsdom has no layout, so blocks are given fixed heights and stacked:
// each block's rect is computed from its order and the spacers before it.
function stack(heights: number[]): {
  root: HTMLElement;
  blocks: HTMLElement[];
} {
  const root = document.createElement("div");
  const blocks = heights.map((h) => {
    const el = document.createElement("p");
    el.dataset.h = String(h);
    root.appendChild(el);
    return el;
  });
  document.body.replaceChildren(root);
  const heightOf = (el: Element) =>
    el.classList.contains("levis-page-spacer")
      ? parseFloat((el as HTMLElement).style.height) || 0
      : Number((el as HTMLElement).dataset.h ?? 0);
  for (const el of [root, ...blocks]) {
    el.getBoundingClientRect = function () {
      let top = 0;
      for (const sibling of Array.from(root.children)) {
        if (sibling === this) break;
        top += heightOf(sibling);
      }
      const height = this === root ? 0 : heightOf(this);
      return { top, bottom: top + height, height } as DOMRect;
    };
  }
  return { root, blocks };
}

describe("paginateDocument", () => {
  it("pushes a block that would cross a seam to the next page's margin", () => {
    // Page 100, margin 10: usable 10..90. The second block (60..100)
    // crosses the bottom band, so it must start at 110.
    const { root, blocks } = stack([60, 40]);
    paginateDocument(document, root, 100, 10);
    const spacers = root.querySelectorAll(".levis-page-spacer");
    expect(spacers).toHaveLength(2);
    expect(blocks[1].getBoundingClientRect().top).toBe(110);
  });

  it("moves a block out of a page's top margin band", () => {
    const { root, blocks } = stack([30]);
    paginateDocument(document, root, 100, 10);
    expect(blocks[0].getBoundingClientRect().top).toBe(10);
  });

  it("leaves a block taller than a page where it is", () => {
    const { root } = stack([300]);
    expect(paginateDocument(document, root, 100, 10)).toBe(0);
  });
});
