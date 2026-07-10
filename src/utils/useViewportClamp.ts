import { useLayoutEffect, useState, type RefObject } from "react";

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
  margin = 8,
): { left: number; top: number } {
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const clamp = () => {
      const rect = el.getBoundingClientRect();
      setPos({
        left: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
        top: Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin)),
      });
    };

    clamp();
    const observer = new ResizeObserver(clamp);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, x, y, margin]);

  return pos;
}
