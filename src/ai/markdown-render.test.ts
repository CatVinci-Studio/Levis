// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdownHtml } from "./markdown-render";

describe("renderMarkdownHtml", () => {
  it("renders inline and display math with KaTeX", () => {
    const html = renderMarkdownHtml("Energy $E=mc^2$.\n\n$$\\frac13$$");
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="agent-math"');
    expect(html).toContain("katex-display");
  });

  it("renders LaTeX's own delimiters too", () => {
    expect(renderMarkdownHtml("so \\(x^2\\) holds")).toContain('class="katex"');
  });

  it("leaves dollar amounts as text", () => {
    const html = renderMarkdownHtml("costs $5 and $10 today");
    expect(html).not.toContain("katex");
    expect(html).toContain("$5 and $10");
  });

  it("renders GFM tables and task lists", () => {
    const html = renderMarkdownHtml(
      "| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] done",
    );
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
  });

  it("still strips script from model output", () => {
    expect(renderMarkdownHtml("<img src=x onerror=alert(1)>")).not.toContain(
      "onerror",
    );
  });
});
