import { Component, type ReactNode } from "react";
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

/**
 * The same, for a change whose cause has no event handler of its own to
 * measure in - a panel opened from a menu, a shortcut, a tour step: every
 * commit in which `watch` changes is measured just before React applies it
 * and played just after, before the frame is painted. Renders nothing.
 *
 * A class because getSnapshotBeforeUpdate is the one hook React runs
 * before it touches the DOM; layout effects all run after.
 */
export class FlipOnChange extends Component<{
  watch: unknown;
  /** The elements to slide, looked up at measuring time. */
  targets: () => Iterable<Element>;
  duration?: DurationToken | number;
  easing?: EasingToken;
}> {
  getSnapshotBeforeUpdate(previous: { watch: unknown }): Snapshot | null {
    if (Object.is(previous.watch, this.props.watch) || !motionAllowed())
      return null;
    return measure(this.props.targets());
  }

  componentDidUpdate(_: unknown, __: unknown, before: Snapshot | null) {
    if (before)
      play(before, {
        duration: this.props.duration,
        easing: this.props.easing,
      });
  }

  render(): ReactNode {
    return null;
  }
}
