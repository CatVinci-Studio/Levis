import {
  animate,
  motionAllowed,
  type DurationToken,
  type EasingToken,
} from "./motion";

/**
 * FLIP: a list whose items moved (a tab closed, a card collapsed, a row
 * removed) lets each survivor slide from where it was to where it now is,
 * on transforms alone - the layout itself changes once, in one frame.
 *
 * First `measure` where everything is, change the DOM (React commits it),
 * then `play`. In React the two halves straddle a commit: measure in the
 * event handler that causes the change, play in a layout effect.
 */

export type Snapshot = Map<Element, DOMRect>;

const FLIP_ID = "flip";

/** Where each element is on screen now, any slide in flight included -
 *  so a second change mid-slide continues from where things are. */
export function measure(elements: Iterable<Element>): Snapshot {
  const rects: Snapshot = new Map();
  for (const el of elements) rects.set(el, el.getBoundingClientRect());
  return rects;
}

/** Slides every element of `before` that has moved from its old place to
 *  its new one. Reads all the new places first, then starts the slides. */
export function play(
  before: Snapshot,
  {
    duration = "--dur-base",
    easing = "--ease-in-out",
  }: { duration?: DurationToken | number; easing?: EasingToken } = {},
): void {
  if (!motionAllowed()) return;
  const targets = [...before.keys()].filter((el) => el.isConnected);
  // Slides still running were measured into `before`; they must not count
  // again in the new positions.
  for (const el of targets)
    for (const running of el.getAnimations?.() ?? [])
      if (running.id === FLIP_ID) running.cancel();
  const moves: { el: Element; dx: number; dy: number }[] = [];
  for (const el of targets) {
    const was = before.get(el)!;
    const now = el.getBoundingClientRect();
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) moves.push({ el, dx, dy });
  }
  for (const { el, dx, dy } of moves)
    animate(
      el,
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration, easing, id: FLIP_ID },
    );
}

/** measure, `mutate` (a synchronous DOM change), play. */
export function flip(
  elements: Iterable<Element>,
  mutate: () => void,
  options?: Parameters<typeof play>[1],
): void {
  const before = measure(elements);
  mutate();
  play(before, options);
}
