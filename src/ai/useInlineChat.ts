import { useCallback, useState } from "react";
import { editorViewCtx, parserCtx } from "@milkdown/kit/core";
import { Slice } from "@milkdown/kit/prose/model";
import { findUniqueTextRange } from "./doc-text";
import type { EditorRunner } from "../editor/useEditorRunner";

export interface InlineChatInfo {
  x: number;
  y: number;
  document: string;
  selectedText: string | null;
  /** Selection bounds at open time - what "replace selection" targets. */
  range: { from: number; to: number } | null;
  /** Caret position at open time - what "insert at cursor" targets. */
  anchor: number;
}

/** Where an AI reply gets applied to the document. */
export type ApplyTarget = "selection" | "cursor" | "document";

/** User-facing error strings, passed as a getter so they follow the live language setting. */
export interface InlineChatMessages {
  applyStale: string;
  proposalFailed: string;
}

/**
 * State + actions for the floating inline chat bar. Opening captures the
 * caret coordinates, the full document, and the selection (text + bounds)
 * as the chat's context; `applyResult` is the confirmation step that writes
 * an AI reply back into the document - replacing the captured selection,
 * inserting at the captured caret, or replacing the whole document. The
 * reply is parsed as markdown so formatted output lands rendered, and a
 * selection replacement is refused (returning an error string) if the
 * selected text changed while the chat was open.
 */
export function useInlineChat(run: EditorRunner, messages: () => InlineChatMessages) {
  const [chatInfo, setChatInfo] = useState<InlineChatInfo | null>(null);

  const toggle = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      setChatInfo((prev) => {
        if (prev) return null; // already open - toggle closes it
        const { selection } = view.state;
        const coords = view.coordsAtPos(selection.from);
        const selectedText = selection.empty
          ? null
          : view.state.doc.textBetween(selection.from, selection.to, " ");
        const fullDocument = view.state.doc.textBetween(0, view.state.doc.content.size, "\n\n");
        return {
          x: coords.left,
          y: coords.bottom + 6,
          document: fullDocument,
          selectedText,
          range: selection.empty ? null : { from: selection.from, to: selection.to },
          anchor: selection.from,
        };
      });
    });
  }, [run]);

  const close = useCallback(() => setChatInfo(null), []);

  const applyResult = useCallback(
    (text: string, target: ApplyTarget): string | null => {
      if (!chatInfo) return null;
      let error: string | null = null;
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const docSize = state.doc.content.size;

        let parsed;
        try {
          parsed = ctx.get(parserCtx)(text);
        } catch {
          parsed = null;
        }

        if (target === "document") {
          const tr = parsed
            ? state.tr.replaceWith(0, docSize, parsed.content)
            : state.tr.insertText(text, 0, docSize);
          view.dispatch(tr.scrollIntoView());
        } else if (target === "selection" && chatInfo.range) {
          const { from, to } = chatInfo.range;
          const stillThere =
            to <= docSize && state.doc.textBetween(from, to, " ") === (chatInfo.selectedText ?? "");
          if (!stillThere) {
            error = messages().applyStale;
            return;
          }
          const tr = parsed
            ? state.tr.replaceRange(from, to, Slice.maxOpen(parsed.content))
            : state.tr.insertText(text, from, to);
          view.dispatch(tr.scrollIntoView());
        } else {
          const at = Math.min(chatInfo.anchor, docSize);
          const tr = parsed
            ? state.tr.replaceRange(at, at, Slice.maxOpen(parsed.content))
            : state.tr.insertText(text, at, at);
          view.dispatch(tr.scrollIntoView());
        }
        view.focus();
      });
      return error;
    },
    [run, chatInfo, messages],
  );

  /**
   * Applies one propose_edit tool call from the agent: locate the quoted
   * snippet in the document (it must still match exactly once) and replace
   * it. This is the other half of the backend's propose_edit tool - the
   * model only ever proposes; this click is what actually edits.
   */
  const applyProposal = useCallback(
    (find: string, replace: string): string | null => {
      let error: string | null = messages().proposalFailed;
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const range = findUniqueTextRange(view.state.doc, find);
        if (!range) return;
        view.dispatch(view.state.tr.insertText(replace, range.from, range.to).scrollIntoView());
        view.focus();
        error = null;
      });
      return error;
    },
    [run, messages],
  );

  return { chatInfo, toggle, close, applyResult, applyProposal };
}
