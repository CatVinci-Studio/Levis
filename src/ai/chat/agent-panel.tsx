import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import "./agent-panel.css";
import "./inline-chat.css";

/**
 * The docked Agent panel on the right of the editor window - the full
 * conversation's default home (the detached window remains, one click away,
 * for a second monitor).
 *
 * App owns only the frame: whether it's open, how wide, and the DOM element
 * to render into. The conversation itself stays where it already lives, in
 * each tab's editor (MilkdownEditor), which portals its own chat into the
 * frame while it is the active tab. So switching tabs switches the
 * conversation with the document, and the panel talks to its editor
 * directly - none of the detached window's context pushing between webviews,
 * which is where most of that surface's bugs came from.
 */
export interface AgentPanelFrame {
  setOpen: (open: boolean) => void;
  /** The element the active editor portals into; null while closed. */
  container: HTMLElement | null;
}

const AgentPanelContext = createContext<AgentPanelFrame>({
  setOpen: () => {},
  container: null,
});

export function useAgentPanel(): AgentPanelFrame {
  return useContext(AgentPanelContext);
}

const OPEN_KEY = "levis-agent-panel-open";
const WIDTH_KEY = "levis-agent-panel-width";
const AGENT_PANEL_MIN_WIDTH = 300;
const AGENT_PANEL_MAX_WIDTH = 720;
const DEFAULT_WIDTH = 380;

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Unavailable storage: the panel still works, it just won't remember.
  }
}

function clampWidth(width: number): number {
  return Math.min(
    AGENT_PANEL_MAX_WIDTH,
    Math.max(AGENT_PANEL_MIN_WIDTH, width),
  );
}

/** The panel's open state and width, remembered across launches. */
export function useAgentPanelState() {
  const [open, setOpenState] = useState(() => readStored(OPEN_KEY) === "1");
  const [width, setWidthState] = useState(() => {
    const stored = Number(readStored(WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0
      ? clampWidth(stored)
      : DEFAULT_WIDTH;
  });
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    writeStored(OPEN_KEY, next ? "1" : "0");
  }, []);
  const setWidth = useCallback((next: number) => {
    const clamped = clampWidth(next);
    setWidthState(clamped);
    writeStored(WIDTH_KEY, String(Math.round(clamped)));
  }, []);
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  return { open, setOpen, toggle, width, setWidth };
}

export function AgentPanelProvider({
  open,
  setOpen,
  container,
  children,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  container: HTMLElement | null;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ setOpen, container: open ? container : null }),
    [open, setOpen, container],
  );
  return (
    <AgentPanelContext.Provider value={value}>
      {children}
    </AgentPanelContext.Provider>
  );
}

/** Drag handle on the panel's left edge: dragging left widens it. */
export function AgentPanelResizer({
  width,
  onResize,
  label,
}: {
  width: number;
  onResize: (width: number) => void;
  label: string;
}) {
  const [drag, setDrag] = useState<{
    startX: number;
    startWidth: number;
  } | null>(null);
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) =>
      onResize(drag.startWidth + (drag.startX - e.clientX));
    const up = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, onResize]);
  return (
    <div
      className={`agent-panel-resizer${drag ? " agent-panel-resizer-active" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={AGENT_PANEL_MIN_WIDTH}
      aria-valuemax={AGENT_PANEL_MAX_WIDTH}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        setDrag({ startX: e.clientX, startWidth: width });
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onResize(width + 20);
        else if (e.key === "ArrowRight") onResize(width - 20);
      }}
    />
  );
}

/** How far a drag on the sheet's handle must go to count as one. */
const SHEET_DRAG_THRESHOLD = 40;

/**
 * The handle on top of the panel when it is a bottom sheet (phone widths,
 * ui/mobile.css). A tap toggles half and full height; dragging up expands,
 * dragging down collapses to half, and from half closes the panel.
 */
export function AgentPanelSheetGrip({
  full,
  onFullChange,
  onClose,
  label,
}: {
  full: boolean;
  onFullChange: (full: boolean) => void;
  onClose: () => void;
  label: string;
}) {
  const startY = useRef<number | null>(null);
  return (
    <div
      className="agent-panel-grip"
      role="button"
      aria-label={label}
      aria-expanded={full}
      tabIndex={0}
      onPointerDown={(e) => {
        startY.current = e.clientY;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={(e) => {
        const from = startY.current;
        startY.current = null;
        if (from === null) return;
        const dy = e.clientY - from;
        if (dy < -SHEET_DRAG_THRESHOLD) onFullChange(true);
        else if (dy > SHEET_DRAG_THRESHOLD) {
          if (full) onFullChange(false);
          else onClose();
        } else onFullChange(!full);
      }}
      onPointerCancel={() => (startY.current = null)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onFullChange(!full);
        }
      }}
    >
      <span />
    </div>
  );
}
