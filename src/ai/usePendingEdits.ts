import { useCallback, useMemo, useRef, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import {
  composeMarkdownEdit,
  findMarkdownMatch,
  serializeBlocks,
  serializeRange,
} from "./doc-markdown";
import { applyEditRange } from "./apply-edit";
import { pendingEditKey, type PendingPreview } from "./pending-edit-plugin";
import type { EditProposal } from "./types";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { InlineChatInfo } from "./useInlineChat";

export type PendingStatus = "pending" | "accepted" | "rejected" | "invalid";

/**
 * Resolves propose_edit proposals to live document ranges and shows them as
 * in-document decorations (pending-edit-plugin.ts). Accept/reject lives in
 * the chat's proposal card (ChatMessages.tsx) and calls in here - the
 * decorations are display only, so there is exactly one set of controls for
 * one action. Owned by MilkdownEditor, same lifetime as the editor, so
 * previews survive the chat popup closing and reopening.
 *
 * Anchors resolve in MARKDOWN SOURCE (doc-markdown.ts), matching what the
 * model was shown. This is the only path that writes a reply into the
 * document; there is deliberately no direct-apply fallback that skips the
 * preview.
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
      // `streaming` marks a proposal whose arguments are still arriving -
      // placed early so the text can grow in the document, un-acceptable
      // until the final add for the same callId lands without the flag.
      proposals: {
        callId: string;
        proposal: EditProposal;
        streaming?: boolean;
      }[],
      chatInfo: InlineChatInfo | null,
    ) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const docSize = state.doc.content.size;
        // One serialization per batch, shared by every proposal in it.
        const blocks = serializeBlocks(ctx, state.doc);
        const resolved: PendingPreview[] = [];
        const invalidIds: string[] = [];

        for (const { callId, proposal, streaming } of proposals) {
          let range: { from: number; to: number } | null = null;
          let replacement = proposal.text ?? "";

          if (proposal.action === "append") {
            range = { from: docSize, to: docSize };
          } else if (proposal.action === "replace_selection") {
            // Targets the selection captured when the chat opened. Staleness
            // is judged on the selection's MARKDOWN: that's what the model
            // was shown, so a formatting-only change under it (bolding a
            // word) has to invalidate the proposal just as a text change
            // would - the reply was written against the old formatting.
            if (
              chatInfo?.range &&
              chatInfo.range.to <= docSize &&
              serializeRange(
                ctx,
                state.doc,
                chatInfo.range.from,
                chatInfo.range.to,
              ) === (chatInfo.selectionMarkdown ?? "")
            ) {
              range = chatInfo.range;
            }
          } else {
            const snippet = proposal.anchor ?? "";
            const match = findMarkdownMatch(blocks, snippet);
            if (match) {
              range = { from: match.from, to: match.to };
              replacement = composeMarkdownEdit(
                match,
                proposal.action,
                snippet,
                proposal.text ?? "",
              );
            }
          }

          if (!range) {
            // A still-streaming draft that doesn't resolve just isn't shown
            // yet - the final proposal gets the real verdict; only IT may
            // mark the call invalid.
            if (!streaming) invalidIds.push(callId);
            continue;
          }
          resolved.push({
            callId,
            proposal,
            from: range.from,
            to: range.to,
            expectedText: state.doc.textBetween(range.from, range.to, " "),
            replacement,
            streaming,
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
      let stillStreaming = false;
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const preview = (pendingEditKey.getState(state)?.previews ?? []).find(
          (p) => p.callId === callId,
        );
        if (!preview) return;
        // The arguments are still streaming in: `replacement` is incomplete,
        // so applying now would write a half-generated edit. Not a failure -
        // the status stays pending and the button works once the final add
        // (same callId, no flag) lands moments later.
        if (preview.streaming) {
          stillStreaming = true;
          return;
        }
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
          preview.replacement,
        );
        // Same transaction: one undo step restores the document exactly,
        // and the decoration is gone the instant the edit lands (no orphan
        // frame where a stale preview paints over the just-applied text).
        tr.setMeta(pendingEditKey, { type: "remove", callId });
        view.dispatch(tr.scrollIntoView());
        view.focus();
        ok = true;
      });
      if (stillStreaming) return false;
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

  /** Every known proposal's status in one object. The per-callId `status`
   *  above is what the local chat card asks; this is what gets pushed to a
   *  detached chat window, which has no access to editor state and so can't
   *  derive "pending" from the live preview list itself. */
  const allStatuses = useMemo(() => {
    const merged: Record<string, PendingStatus> = { ...statuses };
    for (const preview of previews) merged[preview.callId] = "pending";
    return merged;
  }, [previews, statuses]);

  return {
    previews,
    allStatuses,
    showPreviews,
    accept,
    reject,
    acceptAll,
    rejectAll,
    status,
    syncFromPlugin,
  };
}
