import { useCallback, useRef, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import {
  documentMarkdown,
  serializeBlocks,
  serializeRange,
} from "./doc-markdown";
import type { EditorRunner } from "../editor/useEditorRunner";

export interface InlineChatInfo {
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
  /** The document position right after the top-level block the selection
   *  ends in - where quick-ask-widget-plugin places the panel. A real
   *  ProseMirror position, so it maps through edits like any other one
   *  (unlike the old floating popup's screen coordinates, which never
   *  followed the document). */
  widgetPos: number;
}

/**
 * State + actions for the Quick Ask bar. Opening captures the document, the
 * selection (plain + markdown + bounds), and the block position the panel
 * should render after - the range a `replace_selection` proposal targets,
 * and what usePendingEdits re-checks for staleness before writing.
 *
 * Nothing here writes to the document. A reply reaches the document only as a
 * pending preview the user accepts (usePendingEdits.ts) - there is no
 * second, direct-apply path.
 */
export function useInlineChat(run: EditorRunner) {
  const [chatInfo, setChatInfo] = useState<InlineChatInfo | null>(null);
  // Whether the PANEL is on screen. Separate from chatInfo because detaching
  // into a window hides the panel while the context must survive: proposals
  // arriving from the detached window still resolve against the selection and
  // document captured when this request was made.
  const [visible, setVisible] = useState(false);
  // Read from callbacks registered once (the detached-chat bridge), which
  // would otherwise close over a stale chatInfo.
  const chatInfoRef = useRef<InlineChatInfo | null>(null);
  chatInfoRef.current = chatInfo;

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
          const selectedText = selection.empty
            ? null
            : view.state.doc.textBetween(selection.from, selection.to, " ");
          const selectionMarkdown = selection.empty
            ? null
            : serializeRange(ctx, view.state.doc, selection.from, selection.to);
          const $to = view.state.doc.resolve(selection.to);
          const widgetPos =
            $to.depth >= 1 ? $to.after(1) : view.state.doc.content.size;
          return next(prev, {
            document: documentMarkdown(serializeBlocks(ctx, view.state.doc)),
            selectedText,
            selectionMarkdown,
            range: selection.empty
              ? null
              : { from: selection.from, to: selection.to },
            anchor: selection.from,
            widgetPos,
          });
        });
      });
    },
    [run],
  );

  /** Opens the bar (or keeps it open). The caller decides whether this is a
   *  fresh conversation or a restored history entry before opening. */
  const open = useCallback(() => {
    setVisible(true);
    openWith((prev, computed) => prev ?? computed);
  }, [openWith]);

  /** Panel off, context kept - what detaching into a window does. */
  const hide = useCallback(() => setVisible(false), []);

  const close = useCallback(() => {
    setVisible(false);
    setChatInfo(null);
  }, []);

  return { chatInfo, chatInfoRef, visible, open, hide, close };
}
