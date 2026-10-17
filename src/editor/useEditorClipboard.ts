import { useCallback } from "react";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { Slice } from "@milkdown/kit/prose/model";
import { AllSelection } from "@milkdown/kit/prose/state";
import type { EditorRunner } from "./useEditorRunner";
import { recordClipboardEntry } from "../clipboard/history";
import { parseMarkdownSource } from "./markdown/parse-markdown-source";
import { bareUrl, insertUrlLink } from "./markdown/paste-url";

export interface EditorClipboard {
  copyOrCut: (cut: boolean) => void;
  paste: () => void;
  selectAll: () => void;
  /** Insert arbitrary markdown text at the cursor, exactly like pasting it. */
  insertText: (text: string) => void;
}

/**
 * Clipboard actions for the context menu: copy/cut put on the clipboard
 * what Cmd+C does (the formatted HTML, and plain text as the Copy setting
 * says), and paste parses clipboard text as
 * markdown so formatted content lands as rendered nodes instead of staying
 * literal source. Cmd+C/V already behave this way via milkdown's clipboard
 * plugin - these are the menu-driven equivalents, which can't go through
 * the native clipboard events.
 */
/** The clipboard's HTML when it is a copy from a Textus editor; null when
 *  it isn't, or the webview can't read rich clipboard content. */
async function ownHtml(): Promise<string | null> {
  try {
    for (const item of await navigator.clipboard.read()) {
      if (!item.types.includes("text/html")) continue;
      const html = await (await item.getType("text/html")).text();
      if (html.includes("data-pm-slice")) return html;
    }
  } catch {
    // No rich clipboard access here: the text path.
  }
  return null;
}

export function useEditorClipboard(run: EditorRunner): EditorClipboard {
  const copyOrCut = useCallback(
    (cut: boolean) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const { from, to } = state.selection;
        // The history keeps the Markdown source, as for Cmd+C
        // (clipboard/history-plugin.ts).
        let markdown: string;
        try {
          markdown = ctx.get(serializerCtx)(state.doc.cut(from, to)).trimEnd();
        } catch {
          markdown = state.doc.textBetween(from, to, "\n");
        }
        // The clipboard gets what Cmd+C puts there: the formatted HTML, and
        // the plain text the Copy setting asks for (plain-text-copy-plugin).
        const { dom, text } = view.serializeForClipboard(
          state.selection.content(),
        );
        void (async () => {
          if (markdown) {
            try {
              await navigator.clipboard.write([
                new ClipboardItem({
                  "text/html": new Blob([dom.innerHTML], { type: "text/html" }),
                  "text/plain": new Blob([text], { type: "text/plain" }),
                }),
              ]);
            } catch {
              // A webview without ClipboardItem: the plain text alone.
              await navigator.clipboard.writeText(text);
            }
            // navigator.clipboard bypasses the DOM copy event the history's
            // document-level capture listens on - record explicitly.
            recordClipboardEntry(markdown);
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
        const url = bareUrl(text);
        if (url !== null && insertUrlLink(view, url)) {
          view.focus();
          return;
        }
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
      // A copy from Textus itself comes back whole from its HTML (marked
      // data-pm-slice by ProseMirror): its plain text may be the readable
      // flavor now (plain-text-copy-plugin), which would lose the
      // formatting. Anything else goes the text way, as before.
      const html = await ownHtml();
      if (html) {
        run((ctx) => {
          const view = ctx.get(editorViewCtx);
          view.pasteHTML(html);
          view.focus();
        });
        return;
      }
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
