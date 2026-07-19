import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface ViewportClampOptions {
  margin?: number;
  /** "down" (default): top pinned at `y`, grows toward the bottom edge.
   *  "up": bottom edge pinned near `y` (established on first render), grows
   *  toward the top edge instead - for popups whose input row should stay
   *  put while a message list accumulates above it. */
  grow?: "down" | "up";
}

/**
 * Keeps a fixed-position popup fully inside the viewport: give it the
 * anchor point you WANT (usually just below the caret or a hovered element)
 * and it returns the position to actually render at, pulled back from the
 * window edges. Re-clamps whenever the element resizes (chat messages
 * arriving, popover text wrapping), via ResizeObserver - popups grow, and a
 * position that fit when empty overflows once they do.
 */
export function useViewportClamp(
  ref: RefObject<HTMLElement | null>,
  x: number,
  y: number,
  options: ViewportClampOptions = {},
): { left: number; top: number } {
  const { margin = 8, grow = "down" } = options;
  const [pos, setPos] = useState({ left: x, top: y });
  // Established on the first clamp of a given (x, y) when grow === "up" -
  // the bottom edge that later growth pivots around instead of `y` itself.
  const bottomAnchor = useRef<number | null>(null);

  useLayoutEffect(() => {
    bottomAnchor.current = null;
  }, [x, y]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const clamp = () => {
      const rect = el.getBoundingClientRect();
      const desiredTop =
        grow === "up" && bottomAnchor.current !== null
          ? bottomAnchor.current - rect.height
          : y;
      const top = Math.max(
        margin,
        Math.min(desiredTop, window.innerHeight - rect.height - margin),
      );
      if (grow === "up" && bottomAnchor.current === null)
        bottomAnchor.current = top + rect.height;
      setPos({
        left: Math.max(
          margin,
          Math.min(x, window.innerWidth - rect.width - margin),
        ),
        top,
      });
    };

    clamp();
    const observer = new ResizeObserver(clamp);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, x, y, margin, grow]);

  return pos;
}
