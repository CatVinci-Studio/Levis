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
import { getUiState, setUiState } from "../../storage/ui-state";
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

const AGENT_PANEL_MIN_WIDTH = 300;
const AGENT_PANEL_MAX_WIDTH = 720;
const DEFAULT_WIDTH = 380;

function clampWidth(width: number): number {
  return Math.min(
    AGENT_PANEL_MAX_WIDTH,
    Math.max(AGENT_PANEL_MIN_WIDTH, width),
  );
}

/** The panel's open state and width, remembered across launches. */
export function useAgentPanelState() {
  const [open, setOpenState] = useState(
    () => getUiState("agentPanelOpen") === true,
  );
  const [width, setWidthState] = useState(() => {
    const stored = getUiState("agentPanelWidth");
    return typeof stored === "number" && Number.isFinite(stored) && stored > 0
      ? clampWidth(stored)
      : DEFAULT_WIDTH;
  });
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    setUiState("agentPanelOpen", next);
  }, []);
  const setWidth = useCallback((next: number) => {
    const clamped = clampWidth(next);
    setWidthState(clamped);
    setUiState("agentPanelWidth", Math.round(clamped));
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

/** Movement under this many px is a tap on the handle, not a drag. */
const SHEET_TAP_SLOP = 10;

/** Where a sheet let go at `height` (of a `full`-tall maximum) comes to
 *  rest: a flick decides by its direction, a slow drag by the nearest stop -
 *  below a third of the screen the sheet closes. */
export function sheetRestingPlace(
  height: number,
  full: number,
  velocity: number,
): "full" | "half" | "closed" {
  const FLICK = 0.5; // px per ms
  if (velocity < -FLICK) return "full";
  if (velocity > FLICK) return height > full * 0.7 ? "half" : "closed";
  if (height > full * 0.75) return "full";
  if (height < full * 0.33) return "closed";
  return "half";
}

/**
 * The handle on top of the panel when it is a bottom sheet (phone widths,
 * mobile/styles). The sheet follows the finger while it is dragged and
 * settles at full height, half, or closed (sheetRestingPlace); a tap toggles
 * half and full.
 *
 * The press is default-prevented so the handle never takes focus: focus
 * moving off the composer dropped the keyboard, and the web view shrinking
 * under the finger (KeyboardFit.swift) cancelled the drag.
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
  const drag = useRef<{
    startY: number;
    startHeight: number;
    lastY: number;
    lastT: number;
    velocity: number;
    sheet: HTMLElement;
    moved: boolean;
  } | null>(null);
  const settle = (sheet: HTMLElement) => {
    sheet.style.removeProperty("height");
    sheet.style.removeProperty("transition");
  };
  return (
    <div
      className="agent-panel-grip"
      role="button"
      aria-label={label}
      aria-expanded={full}
      tabIndex={0}
      onPointerDown={(e) => {
        const sheet = e.currentTarget.parentElement;
        if (!sheet) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {
          startY: e.clientY,
          startHeight: sheet.getBoundingClientRect().height,
          lastY: e.clientY,
          lastT: e.timeStamp,
          velocity: 0,
          sheet,
          moved: false,
        };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dy = e.clientY - d.startY;
        if (!d.moved && Math.abs(dy) < SHEET_TAP_SLOP) return;
        d.moved = true;
        const dt = e.timeStamp - d.lastT;
        if (dt > 0) d.velocity = (e.clientY - d.lastY) / dt;
        d.lastY = e.clientY;
        d.lastT = e.timeStamp;
        const max = maxSheetHeight(d.sheet);
        d.sheet.style.transition = "none";
        d.sheet.style.height = `${Math.max(0, Math.min(max, d.startHeight - dy))}px`;
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        const dy = e.clientY - d.startY;
        settle(d.sheet);
        if (!d.moved || Math.abs(dy) < SHEET_TAP_SLOP) {
          onFullChange(!full);
          return;
        }
        const height = Math.max(0, d.startHeight - dy);
        const place = sheetRestingPlace(
          height,
          maxSheetHeight(d.sheet),
          d.velocity,
        );
        if (place === "closed") onClose();
        else onFullChange(place === "full");
      }}
      onPointerCancel={() => {
        if (drag.current) settle(drag.current.sheet);
        drag.current = null;
      }}
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

/** The sheet's full height: the screen below the title row. */
function maxSheetHeight(sheet: HTMLElement): number {
  const bar = parseFloat(
    getComputedStyle(sheet).getPropertyValue("--mobile-bar") || "44",
  );
  return window.innerHeight - (Number.isFinite(bar) ? bar : 44);
}
