import { serializerCtx } from "@milkdown/kit/core";
import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { recordClipboardEntry } from "../utils/clipboard-history";

/**
 * Records Cmd+C/Cmd+X copies from the WYSIWYG editor into the clipboard
 * history as markdown source, matching what the clipboard plugin actually
 * writes to the system clipboard. The document-level capture in
 * clipboard-history.ts snapshots `getSelection().toString()` instead, which
 * silently drops everything the editor draws outside the real text: math
 * source hidden behind a KaTeX render (display: none), and the synthesized
 * $ / ** delimiter widgets (user-select: none) - so a copied formula
 * vanished from the history entry. That capture now leaves the WYSIWYG
 * editor to this plugin (see shouldCaptureTextOf) and keeps handling the
 * source-mode textarea, where the DOM selection IS the markdown source.
 */
export const clipboardHistoryPlugin = $prose((ctx) => {
  const record = (view: EditorView) => {
    const { state } = view;
    const { from, to } = state.selection;
    if (from === to) return;
    let text: string;
    try {
      text = ctx.get(serializerCtx)(state.doc.cut(from, to)).trimEnd();
    } catch {
      text = state.doc.textBetween(from, to, "\n");
    }
    if (text) recordClipboardEntry(text);
  };
  return new Plugin({
    props: {
      handleDOMEvents: {
        copy: (view) => {
          record(view);
          return false; // the clipboard plugin still does the actual copy
        },
        cut: (view) => {
          record(view);
          return false;
        },
      },
    },
  });
});
