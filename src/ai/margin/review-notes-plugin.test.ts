// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";
import { createTestEditor } from "../../editor/editor-test-harness";
import { commentCalls, reviewNotesKey } from "./review-notes-plugin";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("review notes", () => {
  it("reads add_comment calls, skipping ones still streaming", () => {
    expect(
      commentCalls([
        { kind: "User", text: "x" } as never,
        {
          kind: "ToolCall",
          name: "add_comment",
          call_id: "a",
          arguments: JSON.stringify({ anchor: "One", comment: "Why?" }),
        },
        {
          kind: "ToolCall",
          name: "add_comment",
          call_id: "b",
          arguments: '{"anchor": "Tw',
        },
        {
          kind: "ToolCall",
          name: "propose_edit",
          call_id: "c",
          arguments: "{}",
        },
      ]),
    ).toEqual([
      { id: "a", anchor: "One", comment: "Why?", context: undefined },
    ]);
  });

  it("stay on their passage through edits and go with it", async () => {
    editor = await createTestEditor("Alpha beta gamma.\n");
    const state = () =>
      editor!.action((ctx) =>
        reviewNotesKey.getState(ctx.get(editorViewCtx).state)!,
      );
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      // "beta" is 7..11 (paragraph opens at 0, text starts at 1).
      view.dispatch(
        view.state.tr.setMeta(reviewNotesKey, {
          type: "set",
          notes: [{ id: "n", from: 7, to: 11, comment: "?" }],
        }),
      );
      view.dispatch(view.state.tr.insertText("Oh ", 1));
    });
    const note = state().notes[0];
    expect(
      editor.action((ctx) =>
        ctx.get(editorViewCtx).state.doc.textBetween(note.from, note.to),
      ),
    ).toBe("beta");
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.delete(note.from, note.to));
    });
    expect(state().notes).toEqual([]);
  });
});
