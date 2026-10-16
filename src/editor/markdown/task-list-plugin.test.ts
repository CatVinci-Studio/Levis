// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { createTestEditor } from "../../document-view/editor-test-harness";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

/** Opens `markdown`, puts the caret at the end of the first textblock
 *  reading exactly `anchor`, types `text` one character at a time, and saves. */
async function typeAfter(
  markdown: string,
  anchor: string,
  text: string,
): Promise<string> {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    let end = -1;
    view.state.doc.descendants((node, pos) => {
      if (end < 0 && node.isTextblock && node.textContent === anchor)
        end = pos + node.nodeSize - 1;
    });
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, end)),
    );
    for (const ch of text) {
      const { from, to } = view.state.selection;
      const handled = view.someProp("handleTextInput", (f) =>
        f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
      );
      if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
    }
    return ctx.get(serializerCtx)(view.state.doc);
  });
}

describe("typing a task spelling", () => {
  it("turns a paragraph into a task", async () => {
    const out = await typeAfter("", "", "-[]x");
    expect(out).toBe("* [ ] x\n");
  });

  it("leaves a table cell's text alone instead of splitting the table", async () => {
    const table = "| a | b |\n| - | - |\n|   | 2 |\n";
    const out = await typeAfter(table, "", "-[]");
    expect(out).not.toContain("[ ]");
    expect(out.match(/\| a/g)).toHaveLength(1);
    expect(out).toMatch(/\| -\\?\[\] *\| 2 \|/);
  });
});
