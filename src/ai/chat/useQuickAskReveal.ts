import { useEffect, type RefObject } from "react";

/** Breathing room kept between the panel's edge and the viewport edge. */
const MARGIN = 12;

/**
 * How much the scroll container has to move for `panel` to be fully visible:
 * positive = scroll down, negative = scroll up, 0 = already fine.
 *
 * A panel TALLER than the viewport can't be shown whole, and then the bottom
 * wins - that's where the composer and the accept/reject bar live, and a
 * pending bar the user can't see is the whole bug this exists for.
 */
export function revealOffset(
  panel: { top: number; bottom: number },
  view: { top: number; bottom: number },
  margin = MARGIN,
): number {
  const below = panel.bottom + margin - view.bottom;
  if (below > 0) return below;
  const above = view.top + margin - panel.top;
  if (above > 0) return -above;
  return 0;
}

/**
 * Keeps the Quick Ask panel inside the editor's scroll viewport.
 *
 * The panel is a zone widget in the document flow (quick-ask-widget-plugin),
 * so opening it on a block near the bottom of the window puts the whole thing
 * - or, as it grows, just its lower rows - below the fold, with nothing to
 * hint that anything opened at all. It grows twice more after that: the
 * one-line reply summary appears above the composer, and the accept/reject
 * bar appears when an answer proposes edits. Each of those pushes the rows
 * below it further down, which is how "the panel is there but the buttons
 * asking me to confirm the edit never showed up" happens.
 *
 * So: reveal once on open, and again whenever the panel's height changes.
 * Never more than the minimum scroll needed, and (after the initial open)
 * only while some part of the panel is still on screen - if the user scrolled
 * away to read elsewhere, a panel that quietly grows must not drag the
 * document back under them.
 */
export function useQuickAskReveal(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = el.closest<HTMLElement>(".editor-scroll");
    if (!scroller) return;

    const reveal = (force: boolean) => {
      const panel = el.getBoundingClientRect();
      if (panel.height === 0) return; // not laid out (hidden tab)
      const view = scroller.getBoundingClientRect();
      const onScreen = panel.bottom > view.top && panel.top < view.bottom;
      if (!force && !onScreen) return;
      scroller.scrollTop += revealOffset(panel, view);
    };

    reveal(true);
    // Height changes: the reply summary arriving, the pending bar appearing,
    // the composer's textarea auto-growing as the user types.
    const observer = new ResizeObserver(() => reveal(false));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}
