// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
  message: vi.fn(),
}));
vi.mock("./ipc", () => ({ exportDoc: {}, fs: {} }));

import { cloneEditorContent } from "./export-doc";

function editor(html: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "milkdown";
  root.innerHTML = html;
  return root;
}

describe("cloneEditorContent", () => {
  it("drops editing affordances that are not document content", () => {
    const html = cloneEditorContent(
      editor(
        '<h1><span class="heading-marker"># </span>Title</h1>' +
          '<div class="code-block-wrapper"><div class="code-block-header">js</div><pre>x</pre></div>',
      ),
    );
    expect(html).not.toContain("heading-marker");
    expect(html).not.toContain("code-block-header");
    expect(html).toContain("Title");
    expect(html).toContain("<pre>x</pre>");
  });

  it("turns a resized table's pixel columns into shares of the page width", () => {
    const html = cloneEditorContent(
      editor(
        '<table style="width: 1000px"><colgroup><col style="width: 750px"><col style="width: 250px"></colgroup><tbody></tbody></table>',
      ),
    );
    expect(html).not.toContain("1000px");
    expect(html).toContain("width: 75%");
    expect(html).toContain("width: 25%");
  });

  it("leaves partly sized tables to share the width evenly", () => {
    const html = cloneEditorContent(
      editor(
        '<table style="min-width: 50px"><colgroup><col style="width: 300px"><col></colgroup><tbody></tbody></table>',
      ),
    );
    expect(html).not.toContain("px");
  });

  it("gives an exported file the document's own image paths back", () => {
    const html = cloneEditorContent(
      editor(
        '<p><img src="asset://localhost/%2Fdocs%2Fassets%2Fa.png" data-doc-src="assets/a.png"></p>',
      ),
    );
    expect(html).toContain('src="assets/a.png"');
    expect(html).not.toContain("asset://");
    expect(html).not.toContain("data-doc-src");
  });

  it("keeps the rendered image source for a self-contained render", () => {
    const html = cloneEditorContent(
      editor(
        '<p><img src="asset://localhost/a.png" data-doc-src="assets/a.png"></p>',
      ),
      "inline",
    );
    expect(html).toContain('src="asset://localhost/a.png"');
  });
});
