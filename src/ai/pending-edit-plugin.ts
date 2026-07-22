import type { EditorState } from "@milkdown/kit/prose/state";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import type { EditProposal } from "./types";

/**
 * One propose_edit tool call, resolved to a live document range (see
 * usePendingEdits.ts, which does the resolution in markdown space via
 * doc-markdown.ts - this plugin only renders and tracks staleness, it never
 * resolves anchors itself). `from === to` for `append`.
 *
 * For anchored actions the range covers the WHOLE blocks the anchor touches,
 * not just the quoted snippet: a markdown offset inside a block has no
 * ProseMirror position, a block boundary does. `replacement` carries the
 * precise, sub-block-accurate result as markdown, so nothing is lost - only
 * the decorated (and re-parsed) range is coarse.
 */
export interface PendingPreview {
  callId: string;
  proposal: EditProposal;
  from: number;
  to: number;
  /** `doc.textBetween(from, to, " ")` at resolution time - the ground truth
   *  a later docChanged re-checks before letting the preview survive. */
  expectedText: string;
  /** Markdown `[from, to)` becomes on accept, composed in markdown space. */
  replacement: string;
}

type PendingMeta =
  | { type: "add"; previews: PendingPreview[] }
  | { type: "remove"; callId: string }
  | { type: "clear" };

interface PendingState {
  previews: PendingPreview[];
  decoration: DecorationSet;
}

export const pendingEditKey = new PluginKey<PendingState>("pending-edit");

export function hasPendingEdits(state: EditorState): boolean {
  return (pendingEditKey.getState(state)?.previews.length ?? 0) > 0;
}

function textWidget(pos: number, side: -1 | 1, text: string) {
  return Decoration.widget(
    pos,
    () => {
      const span = document.createElement("span");
      span.className = "pending-insert";
      span.textContent = text;
      span.contentEditable = "false";
      return span;
    },
    { side },
  );
}

/**
 * One preview's decorations: a struck-through/red-tinted `.pending-delete`
 * span over the range being rewritten, plus a green `.pending-insert`
 * ghost-text widget carrying the new markdown - shown as source text, not
 * parsed nodes, because parsing only happens once (on accept, via
 * apply-edit.ts's parserCtx path) to avoid a second, divergent render path.
 *
 * The widget shows `proposal.text` (what the model actually wrote) rather
 * than the full `replacement`, which for a sub-block edit would repeat the
 * untouched prefix/suffix back at the reader. The exact before/after diff
 * lives in the chat card; in the document these marks only say "this region
 * is changing".
 */
function decorationsFor(p: PendingPreview): Decoration[] {
  const decos: Decoration[] = [];
  // Only actions that actually remove text get the strikethrough; an
  // insert_before/insert_after keeps the anchor blocks verbatim, so striking
  // them through would wrongly read as "this is being deleted".
  const removesText =
    p.proposal.action === "replace" ||
    p.proposal.action === "replace_selection" ||
    p.proposal.action === "delete";
  if (p.from < p.to && removesText) {
    decos.push(Decoration.inline(p.from, p.to, { class: "pending-delete" }));
  }
  const text = p.proposal.text;
  if (text !== undefined && p.proposal.action !== "delete") {
    const atStart = p.proposal.action === "insert_before";
    decos.push(textWidget(atStart ? p.from : p.to, atStart ? -1 : 1, text));
  }
  return decos;
}

function buildDecorations(
  doc: ProseNode,
  previews: PendingPreview[],
): DecorationSet {
  return DecorationSet.create(
    doc,
    previews.flatMap((p) => decorationsFor(p)),
  );
}

/**
 * Shows agent propose_edit proposals as live decorations in the document
 * instead of only a chat-panel diff card - the pending-insert/pending-delete
 * pair is this plugin's whole job; the actual document mutation on accept
 * happens outside it (usePendingEdits.ts), the same way ghost-text-plugin's
 * widget is separate from the Tab keystroke that commits it.
 *
 * Mirrors grammar-check-plugin's staleness handling: every docChanged maps
 * each preview's range through the transaction and drops it if the mapped
 * range's text no longer matches what was resolved - an edit inside or
 * around a pending change invalidates it rather than risk applying to the
 * wrong text later.
 */
export function createPendingEditPlugin(options: {
  /** Accept/reject the first pending preview - ⌘Enter / ⌘Backspace. Wired
   *  to the same accept/reject usePendingEdits.ts exposes for the button
   *  path, so the two can't drift. */
  onAccept?: (callId: string) => void;
  onReject?: (callId: string) => void;
  /** Fired whenever the live preview list changes (add/remove/clear, or a
   *  docChanged that drops a stale one) - the plugin's only way to reach
   *  React, since nothing else polls ProseMirror state. Drives the
   *  in-document accept/reject controls and the chat panel's proposal
   *  status chips. */
  onPreviewsChange?: (previews: PendingPreview[]) => void;
}) {
  return $prose(
    () =>
      new Plugin<PendingState>({
        key: pendingEditKey,
        state: {
          init: (): PendingState => ({
            previews: [],
            decoration: DecorationSet.empty,
          }),
          apply(tr, prev): PendingState {
            const meta = tr.getMeta(pendingEditKey) as PendingMeta | undefined;
            if (meta?.type === "add") {
              const keep = prev.previews.filter(
                (p) => !meta.previews.some((n) => n.callId === p.callId),
              );
              const previews = [...keep, ...meta.previews];
              return {
                previews,
                decoration: buildDecorations(tr.doc, previews),
              };
            }
            if (meta?.type === "remove") {
              const previews = prev.previews.filter(
                (p) => p.callId !== meta.callId,
              );
              return {
                previews,
                decoration: buildDecorations(tr.doc, previews),
              };
            }
            if (meta?.type === "clear") {
              return prev.previews.length === 0
                ? prev
                : { previews: [], decoration: DecorationSet.empty };
            }
            if (tr.docChanged && prev.previews.length > 0) {
              const survivors: PendingPreview[] = [];
              for (const p of prev.previews) {
                const from = tr.mapping.map(p.from, -1);
                const to = tr.mapping.map(p.to, 1);
                if (from > to) continue;
                if (tr.doc.textBetween(from, to, " ") !== p.expectedText)
                  continue;
                survivors.push({ ...p, from, to });
              }
              return {
                previews: survivors,
                decoration: buildDecorations(tr.doc, survivors),
              };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            return pendingEditKey.getState(state)?.decoration;
          },
          handleKeyDown(view, event) {
            const mod = event.metaKey || event.ctrlKey;
            if (!mod) return false;
            const previews =
              pendingEditKey.getState(view.state)?.previews ?? [];
            if (previews.length === 0) return false;
            if (event.key === "Enter") {
              event.preventDefault();
              options.onAccept?.(previews[0].callId);
              return true;
            }
            if (event.key === "Backspace") {
              event.preventDefault();
              options.onReject?.(previews[0].callId);
              return true;
            }
            return false;
          },
        },
        view() {
          let last: PendingPreview[] = [];
          return {
            update(view) {
              const previews =
                pendingEditKey.getState(view.state)?.previews ?? [];
              if (previews !== last) {
                last = previews;
                options.onPreviewsChange?.(previews);
              }
            },
          };
        },
      }),
  );
}
