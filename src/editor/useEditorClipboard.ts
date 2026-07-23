import { useCallback } from "react";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { Slice } from "@milkdown/kit/prose/model";
import { AllSelection } from "@milkdown/kit/prose/state";
import type { EditorRunner } from "./useEditorRunner";
import { recordClipboardEntry } from "../utils/clipboard-history";
import { parseMarkdownSource } from "./parse-markdown-source";

export interface EditorClipboard {
  copyOrCut: (cut: boolean) => void;
  paste: () => void;
  selectAll: () => void;
  /** Insert arbitrary markdown text at the cursor, exactly like pasting it. */
  insertText: (text: string) => void;
}

/**
 * Clipboard actions for the context menu, markdown-aware in both
 * directions: copy/cut serialize the selection back to markdown source
 * ("**bold**", not flat "bold"), and paste parses clipboard text as
 * markdown so formatted content lands as rendered nodes instead of staying
 * literal source. Cmd+C/V already behave this way via milkdown's clipboard
 * plugin - these are the menu-driven equivalents, which can't go through
 * the native clipboard events.
 */
export function useEditorClipboard(run: EditorRunner): EditorClipboard {
  const copyOrCut = useCallback(
    (cut: boolean) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const { from, to } = state.selection;
        let text: string;
        try {
          text = ctx.get(serializerCtx)(state.doc.cut(from, to)).trimEnd();
        } catch {
          text = state.doc.textBetween(from, to, "\n");
        }
        void (async () => {
          if (text) {
            await navigator.clipboard.writeText(text);
            // navigator.clipboard bypasses the DOM copy event the history's
            // document-level capture listens on - record explicitly.
            recordClipboardEntry(text);
          }
          if (cut) view.dispatch(view.state.tr.deleteSelection());
          view.focus();
        })();
      });
    },
    [run],
  );

  const insertText = useCallback(
    (text: string) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        let inserted = false;
        const doc = parseMarkdownSource(ctx, text);
        if (doc && doc.content.size > 0) {
          view.dispatch(
            view.state.tr
              .replaceSelection(Slice.maxOpen(doc.content))
              .scrollIntoView(),
          );
          inserted = true;
        }
        if (!inserted) view.dispatch(view.state.tr.insertText(text));
        view.focus();
      });
    },
    [run],
  );

  const paste = useCallback(() => {
    void (async () => {
      const text = await navigator.clipboard.readText();
      if (!text) {
        run((ctx) => ctx.get(editorViewCtx).focus());
        return;
      }
      recordClipboardEntry(text);
      insertText(text);
    })();
  }, [run, insertText]);

  const selectAll = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(
        view.state.tr.setSelection(new AllSelection(view.state.doc)),
      );
      view.focus();
    });
  }, [run]);

  return { copyOrCut, paste, selectAll, insertText };
}
