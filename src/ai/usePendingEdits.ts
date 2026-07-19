import { useCallback, useRef, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import { findUniqueTextRange } from "./doc-text";
import { applyEditRange } from "./apply-edit";
import { pendingEditKey, type PendingPreview } from "./pending-edit-plugin";
import type { EditProposal } from "./types";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { InlineChatInfo } from "./useInlineChat";

export type PendingStatus = "pending" | "accepted" | "rejected" | "invalid";

/**
 * Resolves propose_edit proposals to live document ranges and shows them as
 * in-document decorations (pending-edit-plugin.ts) instead of only a
 * chat-panel diff card - accept/reject there is what actually edits the
 * document. Owned by MilkdownEditor, same lifetime as the editor, so
 * previews survive the chat popup closing and reopening.
 */
export function usePendingEdits(run: EditorRunner) {
  const [previews, setPreviews] = useState<PendingPreview[]>([]);
  // callId -> terminal status, kept even after the preview leaves `previews`
  // (accept/reject/an invalidating edit all remove it) so a chat card can
  // still show "Applied"/"Rejected"/"Couldn't locate" instead of reverting
  // to a plain, misleading "Pending".
  const [statuses, setStatuses] = useState<Record<string, PendingStatus>>({});
  const knownIds = useRef<Set<string>>(new Set());

  /** Wired (via a ref-indirected callback, see MilkdownEditor) to the
   *  plugin's onPreviewsChange - the only path React learns about a preview
   *  the plugin silently dropped because the document changed under it. */
  const syncFromPlugin = useCallback((next: PendingPreview[]) => {
    const nextIds = new Set(next.map((p) => p.callId));
    const dropped = [...knownIds.current].filter((id) => !nextIds.has(id));
    knownIds.current = nextIds;
    setPreviews(next);
    if (dropped.length > 0) {
      setStatuses((prev) => {
        const copy = { ...prev };
        for (const id of dropped) if (!copy[id]) copy[id] = "invalid";
        return copy;
      });
    }
  }, []);

  const showPreviews = useCallback(
    (
      proposals: { callId: string; proposal: EditProposal }[],
      chatInfo: InlineChatInfo | null,
    ) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const docSize = state.doc.content.size;
        const resolved: PendingPreview[] = [];
        const invalidIds: string[] = [];

        for (const { callId, proposal } of proposals) {
          let range: { from: number; to: number } | null = null;
          if (proposal.action === "append") {
            range = { from: docSize, to: docSize };
          } else if (proposal.action === "replace_selection") {
            // Same staleness rule as the free-text apply path: the selection
            // captured when the chat opened must still read the same.
            if (
              chatInfo?.range &&
              chatInfo.range.to <= docSize &&
              state.doc.textBetween(
                chatInfo.range.from,
                chatInfo.range.to,
                " ",
              ) === (chatInfo.selectedText ?? "")
            ) {
              range = chatInfo.range;
            }
          } else {
            range = findUniqueTextRange(state.doc, proposal.anchor ?? "");
          }

          if (!range) {
            invalidIds.push(callId);
            continue;
          }
          resolved.push({
            callId,
            proposal,
            from: range.from,
            to: range.to,
            expectedText: state.doc.textBetween(range.from, range.to, " "),
          });
        }

        if (resolved.length > 0) {
          view.dispatch(
            state.tr.setMeta(pendingEditKey, {
              type: "add",
              previews: resolved,
            }),
          );
        }
        if (invalidIds.length > 0) {
          setStatuses((prev) => {
            const copy = { ...prev };
            for (const id of invalidIds) copy[id] = "invalid";
            return copy;
          });
        }
      });
    },
    [run],
  );

  const accept = useCallback(
    (callId: string): boolean => {
      let ok = false;
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const preview = (pendingEditKey.getState(state)?.previews ?? []).find(
          (p) => p.callId === callId,
        );
        if (!preview) return;
        // Defensive re-check mirroring the plugin's own staleness rule -
        // not expected to fire (the plugin already drops previews whose
        // mapped text changed), but a silent no-op here would be worse.
        if (
          state.doc.textBetween(preview.from, preview.to, " ") !==
          preview.expectedText
        )
          return;

        const tr = applyEditRange(
          state,
          ctx,
          preview.from,
          preview.to,
          preview.proposal.text ?? "",
        );
        // Same transaction: one undo step restores the document exactly,
        // and the decoration is gone the instant the edit lands (no orphan
        // frame where a stale preview paints over the just-applied text).
        tr.setMeta(pendingEditKey, { type: "remove", callId });
        view.dispatch(tr.scrollIntoView());
        view.focus();
        ok = true;
      });
      setStatuses((prev) => ({
        ...prev,
        [callId]: ok ? "accepted" : "invalid",
      }));
      return ok;
    },
    [run],
  );

  const reject = useCallback(
    (callId: string) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(
          view.state.tr.setMeta(pendingEditKey, { type: "remove", callId }),
        );
      });
      setStatuses((prev) => ({ ...prev, [callId]: "rejected" }));
    },
    [run],
  );

  const rejectAll = useCallback(() => {
    const ids = previews.map((p) => p.callId);
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta(pendingEditKey, { type: "clear" }));
    });
    setStatuses((prev) => {
      const copy = { ...prev };
      for (const id of ids) copy[id] = "rejected";
      return copy;
    });
  }, [run, previews]);

  /** Accepts every currently pending preview, one transaction each (so a
   *  mid-batch failure - text one of them depended on changed - doesn't
   *  undo the ones that already landed). */
  const acceptAll = useCallback(() => {
    for (const p of previews) accept(p.callId);
  }, [previews, accept]);

  const status = useCallback(
    (callId: string): PendingStatus => {
      if (previews.some((p) => p.callId === callId)) return "pending";
      return statuses[callId] ?? "pending";
    },
    [previews, statuses],
  );

  return {
    previews,
    showPreviews,
    accept,
    reject,
    acceptAll,
    rejectAll,
    status,
    syncFromPlugin,
  };
}
