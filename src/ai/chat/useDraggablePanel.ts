import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

export interface PanelFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_WIDTH = 280;
const MIN_HEIGHT = 160;
const EDGE_MARGIN = 8;

/**
 * Lets the chat popup be moved and resized by hand.
 *
 * The popup starts ANCHORED - it follows the document position it was opened
 * on (useAnchoredPosition). The first drag or resize hands control to the
 * user permanently for that popup: `frame` becomes non-null and the caller
 * should stop applying anchored coordinates, because a popup that snapped
 * back to the caret after being deliberately moved would be worse than one
 * that never followed at all.
 *
 * Resizing uses an explicit corner handle rather than CSS `resize: both`. A
 * ResizeObserver can't tell a user drag from the panel growing because
 * messages arrived, so `resize` would silently steal control the first time
 * the agent replied.
 */
export function useDraggablePanel(ref: RefObject<HTMLElement | null>) {
  const [frame, setFrame] = useState<PanelFrame | null>(null);
  // Which gesture is live, plus the pointer offset it started from.
  const gesture = useRef<{
    mode: "move" | "resize";
    dx: number;
    dy: number;
  } | null>(null);

  const currentFrame = useCallback((): PanelFrame | null => {
    const el = ref.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, [ref]);

  const start = useCallback(
    (mode: "move" | "resize") => (event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      const rect = currentFrame();
      if (!rect) return;
      // Freeze the panel at exactly where it is right now, so taking control
      // never makes it jump.
      setFrame(rect);
      gesture.current =
        mode === "move"
          ? {
              mode,
              dx: event.clientX - rect.x,
              dy: event.clientY - rect.y,
            }
          : {
              mode,
              dx: event.clientX - (rect.x + rect.width),
              dy: event.clientY - (rect.y + rect.height),
            };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [currentFrame],
  );

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const active = gesture.current;
      if (!active) return;
      setFrame((prev) => {
        if (!prev) return prev;
        if (active.mode === "move") {
          // Keep at least a sliver on screen in every direction, so a panel
          // dragged off an edge can always be grabbed again.
          const maxX = window.innerWidth - EDGE_MARGIN;
          const maxY = window.innerHeight - EDGE_MARGIN;
          return {
            ...prev,
            x: Math.min(
              Math.max(event.clientX - active.dx, EDGE_MARGIN - prev.width),
              maxX,
            ),
            y: Math.min(Math.max(event.clientY - active.dy, 0), maxY),
          };
        }
        return {
          ...prev,
          width: Math.max(MIN_WIDTH, event.clientX - active.dx - prev.x),
          height: Math.max(MIN_HEIGHT, event.clientY - active.dy - prev.y),
        };
      });
    }
    function onUp() {
      gesture.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  return {
    /** Non-null once the user has moved or resized - anchoring is over. */
    frame,
    onMoveStart: start("move"),
    onResizeStart: start("resize"),
  };
}
