import type { MouseEvent, TouchEvent } from "react";

/** How far a finger may travel and still be tapping rather than scrolling
 *  the list under it (UIKit's own slop is about this). */
const TAP_SLOP = 10;

/** Where each touch began, per element: kept outside the props so a
 *  re-render between touchstart and touchend (results arriving while the
 *  finger is down) doesn't forget it. */
const touchStarts = new WeakMap<Element, { x: number; y: number }>();

/**
 * Props that run `action` on a press without taking focus from the text
 * field being typed in - for rows picked from a list under a composer (the
 * `/` skill and `@` file suggestions).
 *
 * A mouse runs it on mousedown, whose default (moving focus) is cancelled.
 * A finger runs it on touchend, cancelled there too: that stops the
 * mousedown and click WebKit would synthesise after it - which would run
 * it a second time - and the focus change that would drop the keyboard.
 * A touch that moved is a scroll of the list, not a pick.
 */
export function tapKeepingFocus(action: () => void) {
  return {
    onMouseDown: (e: MouseEvent) => {
      e.preventDefault();
      action();
    },
    onTouchStart: (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch)
        touchStarts.set(e.currentTarget, {
          x: touch.clientX,
          y: touch.clientY,
        });
    },
    onTouchEnd: (e: TouchEvent) => {
      const start = touchStarts.get(e.currentTarget);
      touchStarts.delete(e.currentTarget);
      const touch = e.changedTouches[0];
      if (!start || !touch) return;
      const moved = Math.hypot(
        touch.clientX - start.x,
        touch.clientY - start.y,
      );
      if (moved > TAP_SLOP) return;
      e.preventDefault();
      action();
    },
  };
}
