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
      // Layout size, not the on-screen box: an entrance scaling the popup
      // up from 96% would otherwise have it measured short and placed
      // over the edge it is being kept off.
      const rect = el.getBoundingClientRect();
      const width = el.offsetWidth || rect.width;
      const height = el.offsetHeight || rect.height;
      const desiredTop =
        grow === "up" && bottomAnchor.current !== null
          ? bottomAnchor.current - height
          : y;
      const top = Math.max(
        margin,
        Math.min(desiredTop, window.innerHeight - height - margin),
      );
      if (grow === "up" && bottomAnchor.current === null)
        bottomAnchor.current = top + height;
      setPos({
        left: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
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
