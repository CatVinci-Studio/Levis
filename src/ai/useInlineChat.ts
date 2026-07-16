import { useCallback, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import { findUniqueTextRange } from "./doc-text";
import { applyEditRange } from "./apply-edit";
import type { EditProposal } from "./types";
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

  const openWith = useCallback(
    (next: (prev: InlineChatInfo | null, computed: InlineChatInfo) => InlineChatInfo | null) => {
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
          const fullDocument = view.state.doc.textBetween(0, view.state.doc.content.size, "\n\n");
          return next(prev, {
            x: coords.left,
            y: coords.bottom + 6,
            document: fullDocument,
            selectedText,
            range: selection.empty ? null : { from: selection.from, to: selection.to },
            anchor: selection.from,
          });
        });
      });
    },
    [run],
  );

  const toggle = useCallback(() => {
    openWith((prev, computed) => (prev ? null : computed)); // already open - toggle closes it
  }, [openWith]);

  /** Opens the bar (or keeps it open) - for entry points like the chat
   *  history panel where "toggle" would wrongly close an open bar. */
  const open = useCallback(() => {
    openWith((prev, computed) => prev ?? computed);
  }, [openWith]);

  const close = useCallback(() => setChatInfo(null), []);

  const applyResult = useCallback(
    (rawText: string, target: ApplyTarget): string | null => {
      if (!chatInfo) return null;
      let error: string | null = null;
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const docSize = state.doc.content.size;

        if (target === "document") {
          view.dispatch(applyEditRange(state, ctx, 0, docSize, rawText).scrollIntoView());
        } else if (target === "selection" && chatInfo.range) {
          const { from, to } = chatInfo.range;
          const stillThere =
            to <= docSize && state.doc.textBetween(from, to, " ") === (chatInfo.selectedText ?? "");
          if (!stillThere) {
            error = messages().applyStale;
            return;
          }
          view.dispatch(applyEditRange(state, ctx, from, to, rawText).scrollIntoView());
        } else {
          const at = Math.min(chatInfo.anchor, docSize);
          view.dispatch(applyEditRange(state, ctx, at, at, rawText).scrollIntoView());
        }
        view.focus();
      });
      return error;
    },
    [run, chatInfo, messages],
  );

  /**
   * Applies one propose_edit tool call from the agent. Anchored actions
   * locate the quoted snippet (it must still match exactly once - across
   * paragraphs too, matching the plain-text view the model saw); `append`
   * targets the document end. New text is parsed as markdown so formatted
   * content lands rendered. This is the other half of the backend's
   * propose_edit tool - the model only ever proposes; this click is what
   * actually edits.
   */
  const applyProposal = useCallback(
    (proposal: EditProposal): string | null => {
      let error: string | null = messages().proposalFailed;
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const insertAt = (from: number, to: number) => {
          view.dispatch(applyEditRange(state, ctx, from, to, proposal.text ?? "").scrollIntoView());
        };

        if (proposal.action === "replace_selection") {
          // Targets the selection captured when the chat opened - same
          // bounds and same staleness rule as the free-text apply path.
          if (!chatInfo?.range) return;
          const { from, to } = chatInfo.range;
          const stillThere =
            to <= state.doc.content.size &&
            state.doc.textBetween(from, to, " ") === (chatInfo.selectedText ?? "");
          if (!stillThere) {
            error = messages().applyStale;
            return;
          }
          insertAt(from, to);
        } else if (proposal.action === "append") {
          insertAt(state.doc.content.size, state.doc.content.size);
        } else {
          const range = findUniqueTextRange(state.doc, proposal.anchor ?? "");
          if (!range) return;
          if (proposal.action === "replace") insertAt(range.from, range.to);
          else if (proposal.action === "insert_before") insertAt(range.from, range.from);
          else if (proposal.action === "insert_after") insertAt(range.to, range.to);
          else if (proposal.action === "delete") view.dispatch(state.tr.deleteRange(range.from, range.to).scrollIntoView());
          else return;
        }
        view.focus();
        error = null;
      });
      return error;
    },
    [run, messages, chatInfo],
  );

  return { chatInfo, toggle, open, close, applyResult, applyProposal };
}
