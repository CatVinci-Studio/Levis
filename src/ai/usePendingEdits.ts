import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import { parseMarkdownSource } from "../editor/parse-markdown-source";
import {
  composeMarkdownEdit,
  findMarkdownMatch,
  serializeBlocks,
  serializeRange,
  type MarkdownBlock,
  type MarkdownMatch,
} from "./doc-markdown";
import { applyEditRange } from "./apply-edit";
import { isIOSApp } from "../platform/capabilities";
import { pendingEditKey, type PendingPreview } from "./pending-edit-plugin";
import { nextFocusAfterChange, orderForReview } from "./pending-edit-focus";
import { locatePlainText } from "./text-locate";
import type { EditProposal } from "./types";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";

/** `streaming`: the proposal exists but can't be decided yet - its
 *  arguments are still arriving or its text is still typing into the
 *  document (pending-edit-plugin settles it when the reveal completes). */
export type PendingStatus =
  "pending" | "streaming" | "accepted" | "rejected" | "invalid" | "expired";

/**
 * What a `replace_selection` proposal targets: the selection the request was
 * sent with, in this window's coordinates.
 *
 * Narrower than the whole `InlineChatInfo` on purpose, because there are now
 * two things that can supply it and only one of them is Quick Ask. The
 * detached window is the cross-file surface, so it can be asked to rewrite a
 * selection in a tab that never opened the in-document bar at all - and then
 * there is no chatInfo to resolve against. Each surface passes the selection
 * IT sent (MilkdownEditor's showProposals), which is also the only one the
 * model was actually shown. `InlineChatInfo` satisfies this structurally, so
 * the Quick Ask path is unchanged.
 */
export interface SelectionTarget {
  range: { from: number; to: number } | null;
  selectionMarkdown: string | null;
  /** The caret when the request was sent with nothing selected - where an
   *  insert_at_cursor proposal writes. */
  cursor?: number | null;
}

/**
 * A tighter strike range for `replace`/`delete`, covering just the text
 * actually being removed rather than the whole containing block - see
 * text-locate.ts for why plain-text location sidesteps the markdown-offset
 * constraint that forces `match.from`/`match.to` to the block boundary.
 * Null (falls back to the whole-block range) whenever the match spans more
 * than one block, the matched markdown fails to parse, or its plain text
 * isn't uniquely findable in the block - never a worse result than today's
 * whole-block strike, only sometimes a more precise one.
 */
function computeStrikeRange(
  ctx: Ctx,
  doc: ProseNode,
  blocks: MarkdownBlock[],
  match: MarkdownMatch,
): { from: number; to: number } | null {
  const block = blocks.find((b) => b.from === match.from);
  if (!block || block.to !== match.to) return null; // spans more than one block

  const matched = match.markdown.slice(
    match.prefix.length,
    match.markdown.length - match.suffix.length,
  );
  if (!matched) return null;

  // The shared guarded parse (its math normalization is a no-op here -
  // `matched` came from this editor's own serializer, so math is already
  // $-delimited).
  const parsed = parseMarkdownSource(ctx, matched);
  if (!parsed || typeof parsed === "string") return null;
  const parsedText = parsed.textContent;
  if (!parsedText) return null;

  return locatePlainText(doc, match.from, match.to, parsedText);
}

/** Where an agent's quoted passage is in the document now - narrowed to the
 *  quoted text when it sits inside one block, else the touched blocks. For
 *  a comment card's "locate". */
export function locateAnchor(
  ctx: Ctx,
  doc: ProseNode,
  anchor: string,
  context?: string,
): { from: number; to: number } | null {
  const blocks = serializeBlocks(ctx, doc);
  const match = findMarkdownMatch(blocks, anchor, context);
  if (!match) return null;
  return (
    computeStrikeRange(ctx, doc, blocks, match) ?? {
      from: match.from,
      to: match.to,
    }
  );
}

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
 * preview. The full proposal lifecycle - streaming, stop/failure endings,
 * what a consecutive prompt supersedes - is laid out in docs/AI-PROPOSALS.md.
 */
export function usePendingEdits(run: EditorRunner) {
  const [previews, setPreviews] = useState<PendingPreview[]>([]);
  // callId -> terminal status, kept even after the preview leaves `previews`
  // (accept/reject/an invalidating edit all remove it) so a chat card can
  // still show "Applied"/"Rejected"/"Couldn't locate" instead of reverting
  // to a plain, misleading "Pending".
  const [statuses, setStatuses] = useState<Record<string, PendingStatus>>({});
  const knownIds = useRef<Set<string>>(new Set());

  // "Review one at a time" state for Quick Ask (MilkdownEditor's nav bar) -
  // ordered by document position, not arrival order, so Next reads top to
  // bottom the way scrolling through the document would.
  const [focusedCallId, setFocusedCallId] = useState<string | null>(null);
  const decidable = useMemo(() => orderForReview(previews), [previews]);
  const focusIndex = focusedCallId
    ? decidable.findIndex((p) => p.callId === focusedCallId)
    : -1;
  const focusedPreview = focusIndex >= 0 ? decidable[focusIndex] : null;

  // Re-points the focus whenever the navigable set changes (a preview
  // settled into it, or left it via accept/reject/invalidation) - keeping
  // the pointer's POSITION (see nextFocusAfterChange) rather than resetting
  // to the start every time.
  const lastOrderRef = useRef<string[]>([]);
  useEffect(() => {
    const newOrder = decidable.map((p) => p.callId);
    setFocusedCallId((prev) =>
      nextFocusAfterChange(lastOrderRef.current, prev, newOrder),
    );
    lastOrderRef.current = newOrder;
  }, [decidable]);

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
      chatInfo: SelectionTarget | null,
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
          let strikeRange: { from: number; to: number } | null = null;

          if (proposal.action === "append") {
            range = { from: docSize, to: docSize };
          } else if (proposal.action === "insert_at_cursor") {
            const at = chatInfo?.cursor;
            if (typeof at === "number" && at <= docSize)
              range = { from: at, to: at };
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
            const match = findMarkdownMatch(blocks, snippet, proposal.context);
            if (match) {
              range = { from: match.from, to: match.to };
              replacement = composeMarkdownEdit(
                match,
                proposal.action,
                proposal.text ?? "",
              );
              if (
                proposal.action === "replace" ||
                proposal.action === "delete"
              ) {
                strikeRange = computeStrikeRange(ctx, state.doc, blocks, match);
              }
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
            strikeFrom: strikeRange?.from,
            strikeTo: strikeRange?.to,
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
    (
      callId: string,
      /** Partial acceptance: the proposal's text with only some of its
       *  sentence changes kept (the card's per-sentence picker). Composed
       *  against the same target the preview resolved. */
      textOverride?: string,
    ): boolean => {
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

        let replacement = preview.replacement;
        if (textOverride !== undefined) {
          const { proposal } = preview;
          if (
            proposal.action === "replace_selection" ||
            proposal.action === "append" ||
            proposal.action === "insert_at_cursor"
          ) {
            replacement = textOverride;
          } else {
            const match = findMarkdownMatch(
              serializeBlocks(ctx, state.doc),
              proposal.anchor ?? "",
              proposal.context,
            );
            if (!match) return;
            replacement = composeMarkdownEdit(
              match,
              proposal.action,
              textOverride,
            );
          }
        }
        const tr = applyEditRange(
          state,
          ctx,
          preview.from,
          preview.to,
          replacement,
        );
        // Same transaction: one undo step restores the document exactly,
        // and the decoration is gone the instant the edit lands (no orphan
        // frame where a stale preview paints over the just-applied text).
        tr.setMeta(pendingEditKey, { type: "remove", callId });
        view.dispatch(tr.scrollIntoView());
        // On a phone, focusing the document raises the keyboard over the
        // AI sheet the Accept was tapped in, and what the user types next
        // lands in the document instead of the composer.
        if (!isIOSApp) view.focus();
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

  // Reads the ids from the plugin's own state rather than the `previews`
  // mirror so the callback stays STABLE ([run] only): MilkdownEditor's
  // ProposalStream machine closes over it, and a rejectAll that changed
  // identity on every preview change would rebuild the machine mid-stream,
  // dropping its accumulated drafts.
  const rejectAll = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const ids = (pendingEditKey.getState(view.state)?.previews ?? []).map(
        (p) => p.callId,
      );
      view.dispatch(view.state.tr.setMeta(pendingEditKey, { type: "clear" }));
      setStatuses((prev) => {
        const copy = { ...prev };
        for (const id of ids) copy[id] = "rejected";
        return copy;
      });
    });
  }, [run]);

  /** Accepts every currently pending preview, one transaction each (so a
   *  mid-batch failure - text one of them depended on changed - doesn't
   *  undo the ones that already landed). */
  const acceptAll = useCallback(() => {
    for (const p of previews) accept(p.callId);
  }, [previews, accept]);

  /** Moves the review pointer by `delta` (wrapping; a fresh pointer starts
   *  at the first preview either way) and returns what it now points at, or
   *  null if there's nothing to navigate - the caller (MilkdownEditor)
   *  reveals that preview immediately, synchronously, rather than waiting
   *  on an effect: unlike accept/reject, moving the pointer doesn't change
   *  the navigable set, so there's nothing to wait for. */
  const step = useCallback(
    (delta: 1 | -1): PendingPreview | null => {
      if (decidable.length === 0) return null;
      const next =
        focusIndex === -1
          ? 0
          : (focusIndex + delta + decidable.length) % decidable.length;
      const preview = decidable[next];
      setFocusedCallId(preview.callId);
      return preview;
    },
    [decidable, focusIndex],
  );
  const focusNext = useCallback(() => step(1), [step]);
  const focusPrevious = useCallback(() => step(-1), [step]);

  /** Accept/reject the currently focused preview - the Quick Ask nav bar's
   *  primary buttons. Unlike focusNext/Previous, WHERE the pointer lands
   *  afterward depends on the plugin round-trip (dispatch -> decoration
   *  state -> onPreviewsChange -> this hook's reindex effect above), so
   *  there's no new preview to return synchronously; the caller reveals the
   *  result via an effect on `focusedPreview` instead. */
  const acceptFocused = useCallback(() => {
    if (focusedCallId) accept(focusedCallId);
  }, [focusedCallId, accept]);

  const rejectFocused = useCallback(() => {
    if (focusedCallId) reject(focusedCallId);
  }, [focusedCallId, reject]);

  /** Every known proposal's status in one object - what gets pushed to a
   *  detached chat window, which has no access to editor state and so can't
   *  derive "pending" from the live preview list itself. Live previews win
   *  over recorded terminal statuses. */
  const allStatuses = useMemo(() => {
    const merged: Record<string, PendingStatus> = { ...statuses };
    for (const preview of previews)
      merged[preview.callId] = preview.streaming ? "streaming" : "pending";
    return merged;
  }, [previews, statuses]);

  /** The markdown a pending replace/replace_selection would replace - what
   *  the card's per-sentence picker diffs the proposal against. */
  const originalText = useCallback(
    (callId: string): string | null =>
      run((ctx) => {
        const { state } = ctx.get(editorViewCtx);
        const preview = (pendingEditKey.getState(state)?.previews ?? []).find(
          (p) => p.callId === callId,
        );
        if (!preview) return null;
        if (preview.proposal.action === "replace")
          return preview.proposal.anchor ?? null;
        if (preview.proposal.action === "replace_selection")
          return serializeRange(ctx, state.doc, preview.from, preview.to);
        return null;
      }) ?? null,
    [run],
  );

  /** Per-callId view of `allStatuses` - what the local chat card asks; one
   *  merge rule, not two that could drift. */
  const status = useCallback(
    // A proposal this editor never showed - from a restored conversation,
    // or one that ended before this session - is no longer decidable.
    // Defaulting to "pending" offered live-looking Accept buttons that could
    // only fail. (A card arriving mid-request reads as streaming instead:
    // see ChatMessages.)
    (callId: string): PendingStatus => allStatuses[callId] ?? "expired",
    [allStatuses],
  );

  return {
    previews,
    allStatuses,
    showPreviews,
    accept,
    originalText,
    reject,
    acceptAll,
    rejectAll,
    status,
    syncFromPlugin,
    decidable,
    focusIndex,
    focusedPreview,
    focusNext,
    focusPrevious,
    acceptFocused,
    rejectFocused,
  };
}
