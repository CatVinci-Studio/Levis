import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { ReviewNote } from "./review-notes-plugin";
import { useViewportClamp } from "../utils/useViewportClamp";
import "./ReviewMargin.css";

export interface ReviewMarginLabels {
  reviewNoteBy: string;
  reviewNoteAsk: string;
  reviewNoteDone: string;
}

/** A note card's width and the air between it and the text. */
const CARD_WIDTH = 232;
const GAP = 28;
/** The least the text column keeps on its left when it moves over. */
const MIN_LEFT = 16;
const STACK_GAP = 8;

interface Placed {
  note: ReviewNote;
  top: number;
  /** Where the line starts: the passage's end, in the layer's coordinates. */
  ax: number;
  ay: number;
}

/**
 * The review notes in the page's margin, beside the passages they are about
 * (review-notes-plugin.ts marks the passages). Each card sits level with
 * its passage, cards that would overlap stack downward, and a thin line
 * runs from the end of the passage to its card. Hovering either lights
 * both.
 *
 * The margin is made, not assumed: when the space right of the text is too
 * narrow the text column moves left to open it (animated, via its
 * margin), and when even that isn't enough - a narrow window, a phone -
 * `onCompact` switches the plugin to numbered badges, and a note opens as
 * a small card at its badge instead (NotePopover).
 */
export function ReviewMargin({
  view,
  notes,
  hot,
  scrollEl,
  contentEl,
  labels,
  onHot,
  onDone,
  onAsk,
  onCompact,
  layoutKey,
}: {
  /** Anything else that moves text without moving the notes (pending
   *  edits drawn or decided): a change re-measures. */
  layoutKey?: unknown;
  view: EditorView | null;
  notes: ReviewNote[];
  hot: string | null;
  scrollEl: HTMLElement;
  contentEl: HTMLElement;
  labels: ReviewMarginLabels;
  onHot: (id: string | null) => void;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
  onCompact: (compact: boolean) => void;
}) {
  const [layout, setLayout] = useState<{
    left: number;
    placed: Placed[];
  } | null>(null);
  const heights = useRef(new Map<string, number>());
  const [tick, setTick] = useState(0);
  const compactRef = useRef(false);

  // Measure: where the text ends, whether a margin fits, where each note's
  // passage is - then stack the cards.
  useLayoutEffect(() => {
    if (!view || notes.length === 0) {
      contentEl.style.marginLeft = "";
      scrollEl.classList.remove("review-notes-on");
      if (compactRef.current) {
        compactRef.current = false;
        onCompact(false);
      }
      setLayout(null);
      return;
    }
    const measure = () => {
      const scrollW = scrollEl.clientWidth;
      const contentW = contentEl.offsetWidth;
      const pm = view.dom as HTMLElement;
      // The text's right edge sits inside the column's padding.
      const pad = contentEl.offsetWidth - pm.offsetWidth;
      const natural = Math.max(0, (scrollW - contentW) / 2);
      const textRight = natural + contentW - pad / 2;
      const room = scrollW - textRight;
      const need = CARD_WIDTH + GAP + 16;
      let shift = 0;
      let compact = false;
      if (room < need) {
        shift = need - room;
        if (natural + pad / 2 - shift < MIN_LEFT) compact = true;
      }
      if (compact !== compactRef.current) {
        compactRef.current = compact;
        onCompact(compact);
      }
      if (compact) {
        contentEl.style.marginLeft = "";
        scrollEl.classList.remove("review-notes-on");
        setLayout(null);
        return;
      }
      scrollEl.classList.add("review-notes-on");
      contentEl.style.marginLeft = shift > 0 ? `${natural - shift}px` : "";
      const left = textRight - shift + GAP;
      const box = scrollEl.getBoundingClientRect();
      const top0 = box.top - scrollEl.scrollTop;
      // Horizontal positions are taken from the column, wherever its
      // margin transition has it right now, and placed where it is going.
      const column = contentEl.getBoundingClientRect();
      const columnLeft = natural - shift;
      const placed: Placed[] = [];
      for (const note of notes) {
        // The marked passage's own boxes: a position's coordinates are
        // ambiguous where widgets (a pending edit's ✓ / ✕) share it.
        const marks = (view.dom as HTMLElement).querySelectorAll<HTMLElement>(
          `.review-anchor[data-note="${CSS.escape(note.id)}"]`,
        );
        const rects = [...marks].flatMap((m) => [...m.getClientRects()]);
        let start: { top: number };
        let end: { right: number; bottom: number };
        if (rects.length > 0) {
          start = rects[0];
          end = rects[rects.length - 1];
        } else {
          try {
            start = view.coordsAtPos(note.from, 1);
            end = view.coordsAtPos(note.to, -1);
          } catch {
            continue;
          }
        }
        placed.push({
          note,
          top: start.top - top0 - 10,
          ax: end.right - column.left + columnLeft + 2,
          ay: end.bottom - top0 - 3,
        });
      }
      placed.sort((a, b) => a.top - b.top);
      let floor = -Infinity;
      for (const p of placed) {
        p.top = Math.max(p.top, floor);
        floor = p.top + (heights.current.get(p.note.id) ?? 64) + STACK_GAP;
      }
      setLayout({ left, placed });
    };
    measure();
    // Anything that can move a passage - typing, a pending edit's widgets
    // drawn or typed in, an image loading, the window resized - re-measures,
    // at most once a frame.
    let frame = 0;
    const soon = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const ro = new ResizeObserver(soon);
    ro.observe(scrollEl);
    ro.observe(view.dom);
    const mo = new MutationObserver(soon);
    mo.observe(view.dom, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(frame);
    };
    // `tick`: a card's measured height changed, restack.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, notes, scrollEl, contentEl, tick, layoutKey]);

  // Unmounting (the editor going away) gives the column its place back.
  useLayoutEffect(
    () => () => {
      contentEl.style.marginLeft = "";
      scrollEl.classList.remove("review-notes-on");
    },
    [contentEl, scrollEl],
  );

  if (!layout) return null;
  return createPortal(
    <div className="review-margin" aria-label={labels.reviewNoteBy}>
      <svg className="review-links" aria-hidden="true">
        {layout.placed.map((p) => {
          const x2 = layout.left;
          const y2 = p.top + 18;
          const dx = Math.max(24, (x2 - p.ax) / 2);
          return (
            <path
              key={p.note.id}
              className={hot === p.note.id ? "hot" : undefined}
              d={`M${p.ax} ${p.ay} C ${p.ax + dx} ${p.ay}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
            />
          );
        })}
      </svg>
      {layout.placed.map((p) => (
        <NoteCard
          key={p.note.id}
          note={p.note}
          hot={hot === p.note.id}
          labels={labels}
          style={{ top: p.top, left: layout.left, width: CARD_WIDTH }}
          onHot={onHot}
          onDone={onDone}
          onAsk={onAsk}
          onHeight={(h) => {
            if (heights.current.get(p.note.id) !== h) {
              heights.current.set(p.note.id, h);
              setTick((t) => t + 1);
            }
          }}
        />
      ))}
    </div>,
    scrollEl,
  );
}

function NoteCard({
  note,
  hot,
  labels,
  style,
  onHot,
  onDone,
  onAsk,
  onHeight,
}: {
  note: ReviewNote;
  hot: boolean;
  labels: ReviewMarginLabels;
  style: CSSProperties;
  onHot: (id: string | null) => void;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
  onHeight?: (height: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !onHeight) return;
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);
  return (
    <div
      ref={ref}
      className={`review-note${hot ? " review-note-hot" : ""}`}
      style={style}
      data-note={note.id}
      onMouseEnter={() => onHot(note.id)}
      onMouseLeave={() => onHot(null)}
    >
      <div className="review-note-by">
        <span className="review-note-mark" aria-hidden="true">
          AI
        </span>
        {labels.reviewNoteBy}
      </div>
      <div className="review-note-text">{note.comment}</div>
      <div className="review-note-actions">
        <button type="button" onClick={() => onAsk(note)}>
          {labels.reviewNoteAsk}
        </button>
        <button type="button" onClick={() => onDone(note.id)}>
          {labels.reviewNoteDone}
        </button>
      </div>
    </div>
  );
}

/** Compact mode: a note opened from its badge, as a small floating card
 *  under it. */
export function NotePopover({
  note,
  x,
  y,
  labels,
  onDone,
  onAsk,
  onClose,
}: {
  note: ReviewNote;
  x: number;
  y: number;
  labels: ReviewMarginLabels;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useViewportClamp(ref, x, y);
  useLayoutEffect(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current?.contains(target) || target.closest?.(".review-badge"))
        return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      className="review-note review-note-popover floating-surface"
      style={pos}
      role="dialog"
      aria-label={labels.reviewNoteBy}
    >
      <div className="review-note-by">
        <span className="review-note-mark" aria-hidden="true">
          AI
        </span>
        {labels.reviewNoteBy}
      </div>
      <div className="review-note-text">{note.comment}</div>
      <div className="review-note-actions">
        <button type="button" onClick={() => onAsk(note)}>
          {labels.reviewNoteAsk}
        </button>
        <button type="button" onClick={() => onDone(note.id)}>
          {labels.reviewNoteDone}
        </button>
      </div>
    </div>,
    document.body,
  );
}
