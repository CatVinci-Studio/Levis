import { useCallback, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import {
  documentMarkdown,
  serializeBlocks,
  serializeRange,
} from "./doc-markdown";
import type { EditorRunner } from "../editor/useEditorRunner";

export interface InlineChatInfo {
  x: number;
  y: number;
  /** The whole document as MARKDOWN SOURCE - see doc-markdown.ts for why
   *  every AI path works in markdown rather than flattened text. */
  document: string;
  /** The selection as plain text. Display only (the composer's "{n} chars
   *  selected" chip); never sent to the model, which sees the markdown. */
  selectedText: string | null;
  /** The selection as markdown - what rides along with the request, and what
   *  a replace_selection proposal's staleness check compares against. */
  selectionMarkdown: string | null;
  /** Selection bounds at open time - what "replace selection" targets. */
  range: { from: number; to: number } | null;
  /** Caret position at open time - what "insert at cursor" targets. */
  anchor: number;
  /** Document position the popup is anchored to, so it can follow the text
   *  as the document changes and the view scrolls (see InlineChat). */
  anchorPos: number;
}

/**
 * State + actions for the floating inline chat bar. Opening captures the
 * caret coordinates, the document, and the selection (plain + markdown +
 * bounds) as the chat's context - the range a `replace_selection` proposal
 * targets, and what usePendingEdits re-checks for staleness before writing.
 *
 * Nothing here writes to the document. A reply reaches the document only as a
 * pending preview the user accepts (usePendingEdits.ts) - there is no
 * second, direct-apply path.
 */
export function useInlineChat(run: EditorRunner) {
  const [chatInfo, setChatInfo] = useState<InlineChatInfo | null>(null);

  const openWith = useCallback(
    (
      next: (
        prev: InlineChatInfo | null,
        computed: InlineChatInfo,
      ) => InlineChatInfo | null,
    ) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        setChatInfo((prev) => {
          const { selection } = view.state;
          // Anchor at the selection's END: a big selection (select-all)
          // should open the bar where the user last sees it, not at the
          // document top.
          const coords = view.coordsAtPos(selection.to);
          const selectedText = selection.empty
            ? null
            : view.state.doc.textBetween(selection.from, selection.to, " ");
          const selectionMarkdown = selection.empty
            ? null
            : serializeRange(ctx, view.state.doc, selection.from, selection.to);
          return next(prev, {
            x: coords.left,
            y: coords.bottom + 6,
            document: documentMarkdown(serializeBlocks(ctx, view.state.doc)),
            selectedText,
            selectionMarkdown,
            range: selection.empty
              ? null
              : { from: selection.from, to: selection.to },
            anchor: selection.from,
            anchorPos: selection.to,
          });
        });
      });
    },
    [run],
  );

  /** Opens the bar (or keeps it open). The caller decides whether this is a
   *  fresh conversation or a restored history entry before opening. */
  const open = useCallback(() => {
    openWith((prev, computed) => prev ?? computed);
  }, [openWith]);

  const close = useCallback(() => setChatInfo(null), []);

  return { chatInfo, open, close };
}
