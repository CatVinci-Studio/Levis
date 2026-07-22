import type { EditorState } from "@milkdown/kit/prose/state";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
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
  /** True while the proposal isn't ready to be decided on: its arguments
   *  are still streaming in (`replacement` incomplete - accept refuses), or
   *  the typewriter is still revealing the text in the document (offering
   *  Accept before the content is even visible was the complaint this
   *  covers). Cleared by the plugin's `settle` meta once the reveal
   *  finishes; surfaced to the UI as the "streaming" PendingStatus. */
  streaming?: boolean;
}

// --- Typewriter reveal for the green pending-insert widget --------------
//
// The animation state lives OUTSIDE the widget DOM, keyed by callId,
// because the two have different lifetimes in both directions: streamed
// text arrives before the widget exists (the plugin add that creates it is
// dispatched in the same tick), and the widget DOM survives decoration
// rebuilds (via the widget `key`) including the final add that replaces a
// streaming preview - whose toDOM is then never called.

interface InsertAnimation {
  callId: string;
  /** Full text known so far - grows while the proposal streams. */
  target: string;
  /** How many chars of `target` are currently revealed. */
  shown: number;
  /** False while more streamed text may still arrive (keeps the caret). */
  done: boolean;
  span: HTMLSpanElement | null;
  timer: number | null;
  /** The view that drew the widget - the reveal's only way to dispatch the
   *  `settle` meta that finally offers Accept/Reject for this preview. */
  view: EditorView | null;
  /** The settle meta was dispatched - never dispatch it twice. */
  settled: boolean;
}

const animations = new Map<string, InsertAnimation>();

const TICK_MS = 30;

/** Whether the callId's text is still being revealed (or may still grow) -
 *  while true, the preview must stay in the un-decidable "streaming" state
 *  even after the final proposal arguments have landed. */
function stillRevealing(callId: string): boolean {
  const anim = animations.get(callId);
  if (!anim) return false;
  return !anim.done || anim.shown < anim.target.length;
}

/** Once the reveal completes, flips the preview out of `streaming` via a
 *  plugin meta so Accept/Reject finally show. Deferred a tick: this is
 *  reached from timer callbacks but also from inside decoration draws,
 *  where a reentrant dispatch is not allowed. */
function maybeSettle(callId: string) {
  const anim = animations.get(callId);
  if (!anim || anim.settled || stillRevealing(callId)) return;
  const view = anim.view;
  if (!view) return; // no widget drawn yet - its toDOM will retry
  anim.settled = true;
  window.setTimeout(() => {
    if (view.isDestroyed) return;
    view.dispatch(
      view.state.tr.setMeta(pendingEditKey, { type: "settle", callId }),
    );
  }, 0);
}

/** What the widget's span actually shows. The proposal text is markdown
 *  SOURCE, where paragraphs are separated by blank lines - rendered through
 *  `white-space: pre-wrap` at the editor's line-height those become huge
 *  gaps, so runs of newlines collapse to one for display. Display only:
 *  the `replacement` applied on accept keeps the real separators. */
function displayText(text: string): string {
  return text.replace(/\n{2,}/g, "\n");
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function stopTimer(anim: InsertAnimation) {
  if (anim.timer !== null) {
    window.clearInterval(anim.timer);
    anim.timer = null;
  }
}

function renderAnimation(anim: InsertAnimation) {
  if (!anim.span) return;
  anim.span.textContent = displayText(anim.target.slice(0, anim.shown));
  anim.span.classList.toggle(
    "pending-insert-typing",
    anim.shown < anim.target.length || !anim.done,
  );
}

/** Reveals a couple of chars per tick, catching up faster the further
 *  behind the target it is - so the pace follows real token arrival while
 *  still reading as steady typing. */
function ensureTicking(anim: InsertAnimation) {
  if (anim.timer !== null || anim.span === null) return;
  if (anim.shown >= anim.target.length) {
    renderAnimation(anim);
    return;
  }
  anim.timer = window.setInterval(() => {
    const remaining = anim.target.length - anim.shown;
    if (remaining > 0) {
      anim.shown = Math.min(
        anim.target.length,
        anim.shown + Math.max(2, Math.ceil(remaining / 15)),
      );
    }
    renderAnimation(anim);
    if (anim.shown >= anim.target.length && anim.done) {
      stopTimer(anim);
      maybeSettle(anim.callId);
    }
  }, TICK_MS);
}

function dropAnimation(callId: string) {
  const anim = animations.get(callId);
  if (!anim) return;
  stopTimer(anim);
  animations.delete(callId);
}

/**
 * Feeds streamed propose_edit text into the callId's green widget - called
 * by the editor (MilkdownEditor's stream-event handler) as `text` argument
 * fragments arrive, and once more with `done` when the call completes. The
 * widget picks the state up whenever it's created relative to this.
 */
export function streamPendingInsertText(
  callId: string,
  text: string,
  done: boolean,
) {
  const existing = animations.get(callId);
  if (!existing) {
    animations.set(callId, {
      callId,
      target: text,
      shown: 0,
      done,
      span: null,
      timer: null,
      view: null,
      settled: false,
    });
    return;
  }
  existing.target = text;
  existing.shown = Math.min(existing.shown, text.length);
  // Both directions: a widget drawn from an early streaming preview creates
  // the entry with done=true (it can't know more text is coming) - the next
  // stream call must be able to reopen it, or the reveal settles mid-stream.
  existing.done = done;
  ensureTicking(existing);
  renderAnimation(existing);
  maybeSettle(callId);
}

type PendingMeta =
  | { type: "add"; previews: PendingPreview[] }
  | { type: "remove"; callId: string }
  | { type: "clear" }
  /** The typewriter finished revealing this preview's text - it may now be
   *  decided on (dispatched by maybeSettle, never from outside). */
  | { type: "settle"; callId: string };

interface PendingState {
  previews: PendingPreview[];
  decoration: DecorationSet;
}

export const pendingEditKey = new PluginKey<PendingState>("pending-edit");

export function hasPendingEdits(state: EditorState): boolean {
  return (pendingEditKey.getState(state)?.previews.length ?? 0) > 0;
}

function textWidget(
  p: PendingPreview,
  pos: number,
  side: -1 | 1,
  animate: boolean,
) {
  return Decoration.widget(
    pos,
    (view) => {
      const span = document.createElement("span");
      span.className = "pending-insert";
      span.contentEditable = "false";
      const text = p.proposal.text ?? "";
      if (!animate || prefersReducedMotion()) {
        span.textContent = displayText(text);
        return span;
      }
      let anim = animations.get(p.callId);
      if (!anim) {
        anim = {
          callId: p.callId,
          target: text,
          shown: 0,
          done: !p.streaming,
          span: null,
          timer: null,
          view: null,
          settled: false,
        };
        animations.set(p.callId, anim);
      } else if (text.length > anim.target.length) {
        // The final proposal's text wins over whatever partial state the
        // stream left behind; a shorter re-add never truncates the target.
        anim.target = text;
      }
      anim.span = span;
      anim.view = view;
      renderAnimation(anim);
      ensureTicking(anim);
      maybeSettle(p.callId);
      return span;
    },
    {
      side,
      // Decorations are rebuilt wholesale on every docChanged; the key
      // makes ProseMirror keep the DOM node across rebuilds, so the
      // typewriter isn't restarted by unrelated keystrokes.
      key: `pending-insert-${p.callId}`,
      destroy: (node) => {
        const anim = animations.get(p.callId);
        if (anim && anim.span === node) {
          anim.span = null;
          stopTimer(anim);
        }
      },
    },
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
function decorationsFor(p: PendingPreview, animate: boolean): Decoration[] {
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
    decos.push(
      textWidget(p, atStart ? p.from : p.to, atStart ? -1 : 1, animate),
    );
  }
  return decos;
}

function buildDecorations(
  doc: ProseNode,
  previews: PendingPreview[],
  animate: boolean,
): DecorationSet {
  return DecorationSet.create(
    doc,
    previews.flatMap((p) => decorationsFor(p, animate)),
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
  /** Whether the green widget types its text in (Settings toggle, read live
   *  per decoration build). Off, or unset: the text appears at once. */
  animationEnabled?: () => boolean;
}) {
  const animate = () => options.animationEnabled?.() ?? false;
  /** Whatever left the preview list takes its typewriter state with it. */
  const dropRemovedAnimations = (
    prev: PendingPreview[],
    next: PendingPreview[],
  ) => {
    for (const p of prev) {
      if (!next.some((n) => n.callId === p.callId)) dropAnimation(p.callId);
    }
  };
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
              // A final (non-streaming) add for a callId whose typewriter is
              // still revealing keeps the streaming state - the settle meta,
              // not the add, is what makes the preview decidable.
              const previews = [
                ...keep,
                ...meta.previews.map((p) =>
                  p.streaming || stillRevealing(p.callId)
                    ? { ...p, streaming: true }
                    : p,
                ),
              ];
              return {
                previews,
                decoration: buildDecorations(tr.doc, previews, animate()),
              };
            }
            if (meta?.type === "settle") {
              if (
                !prev.previews.some(
                  (p) => p.callId === meta.callId && p.streaming,
                )
              )
                return prev;
              const previews = prev.previews.map((p) =>
                p.callId === meta.callId ? { ...p, streaming: undefined } : p,
              );
              return {
                previews,
                decoration: buildDecorations(tr.doc, previews, animate()),
              };
            }
            if (meta?.type === "remove") {
              const previews = prev.previews.filter(
                (p) => p.callId !== meta.callId,
              );
              dropRemovedAnimations(prev.previews, previews);
              return {
                previews,
                decoration: buildDecorations(tr.doc, previews, animate()),
              };
            }
            if (meta?.type === "clear") {
              dropRemovedAnimations(prev.previews, []);
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
              dropRemovedAnimations(prev.previews, survivors);
              return {
                previews: survivors,
                decoration: buildDecorations(tr.doc, survivors, animate()),
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
