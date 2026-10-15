// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../editor-test-harness";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

async function viewOf(markdown: string): Promise<EditorView> {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) => ctx.get(editorViewCtx));
}

/** Presses Shift+Enter with the cursor at document position `pos`. */
function shiftEnterAt(view: EditorView, pos: number) {
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
  );
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    keyCode: 13,
    shiftKey: true,
  });
  view.someProp("handleKeyDown", (f) => f(view, event));
}

describe("Shift+Enter", () => {
  it("adds a line break at the end of a line", async () => {
    const view = await viewOf("一二三\n");
    shiftEnterAt(view, 4);
    expect(view.state.doc.toString()).toBe(
      'doc(paragraph("一二三", hardbreak))',
    );
  });

  it("turns a second break at the end into a new paragraph", async () => {
    const view = await viewOf("一二三\n");
    shiftEnterAt(view, 4);
    shiftEnterAt(view, 5);
    expect(view.state.doc.toString()).toBe(
      'doc(paragraph("一二三"), paragraph)',
    );
  });

  it("adds a break mid-line when the paragraph already ends in one", async () => {
    const view = await viewOf("一二三\n");
    shiftEnterAt(view, 4);
    // Back up after 二 and break the line there: nothing is deleted and
    // no paragraph gap appears.
    shiftEnterAt(view, 3);
    expect(view.state.doc.toString()).toBe(
      'doc(paragraph("一二", hardbreak, "三", hardbreak))',
    );
    expect(view.state.selection.from).toBe(4);
  });

  it("still turns a break right after a break into a paragraph", async () => {
    const view = await viewOf("一二三\n");
    shiftEnterAt(view, 4);
    shiftEnterAt(view, 2);
    // 一<br>|二三<br>: the break before the cursor becomes a paragraph.
    shiftEnterAt(view, 3);
    expect(view.state.doc.toString()).toBe(
      'doc(paragraph("一"), paragraph("二三", hardbreak))',
    );
    expect(view.state.selection.$from.parent.firstChild?.text).toBe("二三");
    expect(view.state.selection.$from.parentOffset).toBe(0);
  });
});

describe("Shift pressed together with Enter", () => {
  function press(view: EditorView, init: KeyboardEventInit, at: number) {
    const event = new KeyboardEvent("keydown", init);
    Object.defineProperty(event, "timeStamp", { value: at });
    view.someProp("handleKeyDown", (f) => f(view, event));
  }

  it("starts a new paragraph when Shift went down just before Enter", async () => {
    const view = await viewOf("一二三\n");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)),
    );
    press(view, { key: "Shift", shiftKey: true }, 1000);
    press(view, { key: "Enter", keyCode: 13, shiftKey: true }, 1040);
    expect(view.state.doc.toString()).toBe(
      'doc(paragraph("一二三"), paragraph)',
    );
  });

  it("keeps a line break when Shift was held first", async () => {
    const view = await viewOf("一二三\n");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)),
    );
    press(view, { key: "Shift", shiftKey: true }, 1000);
    press(view, { key: "Enter", keyCode: 13, shiftKey: true }, 1400);
    expect(view.state.doc.toString()).toBe(
      'doc(paragraph("一二三", hardbreak))',
    );
  });
});
