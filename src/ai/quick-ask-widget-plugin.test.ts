// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { createTestEditor } from "../editor/editor-test-harness";
import { setQuickAskWidget } from "./quick-ask-widget-plugin";
import { blockPositionAfter } from "./useInlineChat";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

describe("the Quick Ask widget", () => {
  it("survives Backspace joining the next paragraph onto its block", async () => {
    const editor = await createTestEditor("first\n\nsecond\n");
    editors.push(editor);
    const anchors = () =>
      editor.action((ctx) =>
        ctx.get(editorViewCtx).dom.querySelectorAll(".quick-ask-anchor"),
      ).length;

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { doc } = view.state;
      view.dispatch(
        setQuickAskWidget(view.state.tr, blockPositionAfter(doc, 1)),
      );
    });
    expect(anchors()).toBe(1);

    // Caret at the start of "second", then the join Backspace makes.
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { doc } = view.state;
      const second = blockPositionAfter(doc, 1);
      const tr = view.state.tr.setSelection(
        TextSelection.create(doc, second + 1),
      );
      view.dispatch(tr.join(second));
    });
    expect(
      editor.action((ctx) => ctx.get(editorViewCtx).state.doc.childCount),
    ).toBe(1);
    expect(anchors()).toBe(1);
  });
});
