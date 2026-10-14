import { Component, type ReactNode, type RefObject } from "react";
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

type Timing = { duration?: DurationToken | number; easing?: EasingToken };

/** Slides every element of `before` that has moved from its old place to
 *  its new one. Reads all the new places first, then starts the slides.
 *  `timingFor` gives one element a timing of its own - the tab that was
 *  let go lands on a spring while the others make way for it. */
export function play(
  before: Snapshot,
  {
    duration = "--dur-base",
    easing = "--ease-in-out",
    timingFor,
  }: Timing & { timingFor?: (el: Element) => Timing | undefined } = {},
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
  for (const { el, dx, dy } of moves) {
    const own = timingFor?.(el);
    animate(
      el,
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      {
        duration: own?.duration ?? duration,
        easing: own?.easing ?? easing,
        id: FLIP_ID,
      },
    );
  }
}

/** What a removed element looked like and where it sat, taken before the
 *  commit that removes it. */
export interface Ghost {
  node: HTMLElement;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A copy of `el` and its place in its offset parent - for an exit played
 *  after React has already removed the original. */
export function captureGhost(el: HTMLElement): Ghost {
  const node = el.cloneNode(true) as HTMLElement;
  // Not one of the list's own items: later measurements must not see it.
  node.removeAttribute("data-flip-id");
  node.removeAttribute("id");
  return {
    node,
    left: el.offsetLeft,
    top: el.offsetTop,
    width: el.offsetWidth,
    height: el.offsetHeight,
  };
}

/**
 * Puts a captured copy back where its original was, out of the layout -
 * the survivors close the gap under it - and lets `className` (a
 * stylesheet animation) play it out. It leaves at the first of its
 * animations ending or `exitMs`, and at once when none runs. `parent` must
 * be the original's offset parent (positioned), so it scrolls with the
 * list it was part of. `under`: put first among the parent's children, so
 * the items moving into its place paint over it - unless a sibling rule
 * (a hairline drawn between rows) would then light up on the item after
 * it.
 */
export function releaseGhost(
  ghost: Ghost,
  parent: HTMLElement,
  className: string,
  exitMs: number,
  under = true,
): void {
  const { node } = ghost;
  node.classList.add(className);
  node.setAttribute("aria-hidden", "true");
  node.inert = true;
  Object.assign(node.style, {
    position: "absolute",
    left: `${ghost.left}px`,
    top: `${ghost.top}px`,
    width: `${ghost.width}px`,
    height: `${ghost.height}px`,
    margin: "0",
    pointerEvents: "none",
  });
  parent.insertBefore(node, under ? parent.firstChild : null);
  const running = node.getAnimations?.() ?? [];
  if (running.length === 0) {
    node.remove();
    return;
  }
  const leave = () => node.remove();
  window.setTimeout(leave, exitMs + 50);
  void Promise.allSettled(running.map((a) => a.finished)).then(leave);
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
    if (!before) return;
    // After the rest of the commit's layout effects - a parent's runs after
    // this, and one may be what moves the layout (zen's class on <html>) -
    // but still before the frame is painted.
    const { duration, easing } = this.props;
    queueMicrotask(() => play(before, { duration, easing }));
  }

  render(): ReactNode {
    return null;
  }
}

/** What a gesture measured itself, mid-move, for ListMotion to start from:
 *  the items' places before it cleared its own shifts, the item it let go
 *  of (it lands on a spring) and one that left with the pointer (nothing
 *  to fade out). */
export interface PendingFlip {
  rects: Snapshot;
  dropped?: string;
  gone?: string;
}

/**
 * The motion of a keyed list across a commit that changes which items it
 * has, or their order (state that lives elsewhere): every item - the
 * `container`'s descendants carrying `data-flip-id` - glides from where it
 * was to where it now is; an item removed stays a moment in its old place
 * as a copy (React has already removed it) to play `ghostClass`'s exit;
 * a new one appears by its own stylesheet animation. Renders nothing.
 */
export class ListMotion extends Component<{
  ids: string[];
  container: RefObject<HTMLElement | null>;
  ghostClass: string;
  /** The longest the ghost's exit runs - a fallback, not a wait. */
  exitMs: number;
  /** See releaseGhost. */
  ghostsUnder?: boolean;
  pending?: RefObject<PendingFlip | null>;
}> {
  getSnapshotBeforeUpdate(previous: { ids: string[] }) {
    const pending = this.props.pending?.current ?? null;
    if (this.props.pending) this.props.pending.current = null;
    const { ids } = this.props;
    const container = this.props.container.current;
    const same =
      previous.ids.length === ids.length &&
      previous.ids.every((id, i) => id === ids[i]);
    if (!container || (same && !pending) || !motionAllowed()) return null;
    const items = container.querySelectorAll<HTMLElement>("[data-flip-id]");
    const ghosts: Ghost[] = [];
    for (const item of items) {
      const id = item.dataset.flipId!;
      if (
        previous.ids.includes(id) &&
        !ids.includes(id) &&
        id !== pending?.gone
      )
        ghosts.push(captureGhost(item));
    }
    return {
      rects: pending?.rects ?? measure(items),
      dropped: pending?.dropped,
      ghosts,
    };
  }

  componentDidUpdate(
    _: unknown,
    __: unknown,
    snapshot: { rects: Snapshot; dropped?: string; ghosts: Ghost[] } | null,
  ) {
    const container = this.props.container.current;
    if (!snapshot || !container) return;
    play(snapshot.rects, {
      timingFor: (el) =>
        el instanceof HTMLElement && el.dataset.flipId === snapshot.dropped
          ? { duration: "--dur-medium", easing: "--ease-spring-bouncy" }
          : undefined,
    });
    for (const ghost of snapshot.ghosts)
      releaseGhost(
        ghost,
        container,
        this.props.ghostClass,
        this.props.exitMs,
        this.props.ghostsUnder ?? true,
      );
  }

  render(): ReactNode {
    return null;
  }
}
