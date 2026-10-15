import { useEffect, useRef } from "react";
import { onFlush } from "../storage/pending-writes";
import { listenToThisWindow, unlistenAll } from "../utils/tauri-events";

/// Document zoom, scoped to the editor CONTENT - the window chrome (tab
/// bar, titlebar filename, sidebar, toolbars) stays at 100%. The factor is
/// published as the `--content-zoom` CSS variable; editor-column.css applies it as
/// CSS `zoom` on the content nodes (.milkdown / .source-view) and widens
/// the content column to match, so the text column scales geometrically
/// like page zoom while fixed overlays (find bar, popovers) keep their
/// unzoomed viewport coordinate space. Three input sources feed one
/// engine: trackpad pinch (WebKit's non-standard gesture events),
/// mod+wheel, and the View menu's Zoom items relayed from Rust.

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
/// Multiplicative step for the menu/keyboard Zoom In/Out items.
const MENU_STEP = 1.1;
/// Trailing delay before a zoom level is persisted to Settings - a pinch or
/// wheel burst updates the ref every frame; only the resting value is saved.
/// A window closing inside it saves at once (storage/pending-writes.ts).
const PERSIST_DELAY_MS = 400;

/// WebKit's proprietary pinch events (gesturestart/change/end) - not in
/// lib.dom because no other engine implements them.
interface WebKitGestureEvent extends UIEvent {
  readonly scale: number;
  readonly clientY: number;
}

function clamp(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/// Snaps near-100% values back to exactly 1 so a pinch that ends around
/// normal size doesn't leave text subtly blurry at 98%.
function snap(zoom: number): number {
  const clamped = clamp(zoom);
  return Math.abs(clamped - 1) < 0.03 ? 1 : clamped;
}

/// The document's top-level block at viewport y `line`: the one it falls
/// in, else the first below it.
function blockAt(content: Element, line: number): Element | null {
  const blocks = content.querySelector(".ProseMirror")?.children;
  if (!blocks) return null;
  for (const block of Array.from(blocks)) {
    if (block.getBoundingClientRect().bottom >= line) return block;
  }
  return null;
}

/**
 * Applies `initialZoom` on mount and owns every zoom input for this window.
 * The live value lives in a ref (not React state) - pinch updates arrive per
 * frame and nothing needs to re-render; `persist` receives the value once it
 * comes to rest. Reads `initialZoom` only on mount: each window's zoom is
 * independent after that, and this hook is itself the only writer.
 */
export function useZoom(initialZoom: number, persist: (zoom: number) => void) {
  const zoomRef = useRef(snap(initialZoom));
  const persistRef = useRef(persist);
  persistRef.current = persist;

  useEffect(() => {
    let raf = 0;
    let persistTimer: ReturnType<typeof setTimeout> | undefined;
    // The zoom actually on screen, and the viewport y the next apply should
    // hold still (the pointer for wheel/pinch; null = the pane's centre).
    let appliedZoom = 1;
    let anchorClientY: number | null = null;

    const apply = () => {
      const next = zoomRef.current;
      const prev = appliedZoom;
      appliedZoom = next;
      // Zooming scales the content's height but leaves scrollTop alone, so
      // without this the text under the pointer slides up or down with
      // every step. Hold the anchor's document position fixed instead.
      const scroller = document.querySelector<HTMLElement>(
        '[data-active-tab="true"] .editor-scroll',
      );
      const content = scroller?.querySelector(".milkdown");
      if (!scroller || !content || prev === next) {
        document.documentElement.style.setProperty(
          "--content-zoom",
          String(next),
        );
        return;
      }
      const box = scroller.getBoundingClientRect();
      const anchor = Math.min(
        box.height,
        Math.max(0, (anchorClientY ?? box.top + box.height / 2) - box.top),
      );
      // The block under the anchor stays under it, at the same share of
      // its height. Scaling the distance into the content alone drifted:
      // where the column widens with the zoom the text rewraps, so the
      // content does not grow in proportion.
      const line = box.top + anchor;
      const block = blockAt(content, line);
      if (block) {
        const was = block.getBoundingClientRect();
        const share = was.height > 0 ? (line - was.top) / was.height : 0;
        document.documentElement.style.setProperty(
          "--content-zoom",
          String(next),
        );
        const now = block.getBoundingClientRect();
        scroller.scrollTop += now.top + share * now.height - line;
        return;
      }
      // The column's padding is outside the zoomed node, so only the
      // distance INTO the content scales.
      const contentTop = () =>
        content.getBoundingClientRect().top - box.top + scroller.scrollTop;
      const before = contentTop();
      const into = Math.max(0, scroller.scrollTop + anchor - before);
      document.documentElement.style.setProperty(
        "--content-zoom",
        String(next),
      );
      scroller.scrollTop = contentTop() + (into * next) / prev - anchor;
    };

    const applyFrame = () => {
      raf = 0;
      apply();
    };

    // Saves the zoom if a save is still waiting for it to come to rest -
    // from the timer, or at once when the window is about to close.
    const persistNow = () => {
      if (persistTimer === undefined) return;
      clearTimeout(persistTimer);
      persistTimer = undefined;
      persistRef.current(zoomRef.current);
    };
    const unregisterFlush = onFlush(persistNow);

    // `snapped: false` while a pinch is mid-flight, so the 100% snap zone
    // doesn't make the gesture feel sticky; the resting snap happens on
    // gestureend.
    const setZoom = (
      zoom: number,
      snapped = true,
      clientY: number | null = null,
    ) => {
      anchorClientY = clientY;
      zoomRef.current = snapped ? snap(zoom) : clamp(zoom);
      if (!raf) raf = requestAnimationFrame(applyFrame);
      clearTimeout(persistTimer);
      persistTimer = setTimeout(persistNow, PERSIST_DELAY_MS);
    };

    // The restored zoom is the starting state, not a step to anchor.
    if (zoomRef.current !== 1) {
      appliedZoom = zoomRef.current;
      document.documentElement.style.setProperty(
        "--content-zoom",
        String(zoomRef.current),
      );
    }

    // Trackpad pinch: scale is cumulative from the gesture's start, so the
    // zoom at gesturestart is the base it multiplies.
    let pinchBase = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      pinchBase = zoomRef.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const { scale, clientY } = e as WebKitGestureEvent;
      if (scale > 0) setZoom(pinchBase * scale, false, clientY);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      setZoom(zoomRef.current, true, (e as WebKitGestureEvent).clientY);
    };

    // mod+wheel zoom (plain scrolling passes through untouched). The
    // exponential mapping makes steps proportional to the current level, so
    // zooming feels uniform at 60% and at 250%. Chromium also reports
    // trackpad pinch as ctrl+wheel, so this path covers pinch there too.
    const onWheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      setZoom(zoomRef.current * Math.exp(-e.deltaY * 0.0015), true, e.clientY);
    };

    window.addEventListener("gesturestart", onGestureStart);
    window.addEventListener("gesturechange", onGestureChange);
    window.addEventListener("gestureend", onGestureEnd);
    window.addEventListener("wheel", onWheel, { passive: false });

    const unlistenMenu = unlistenAll(
      listenToThisWindow("menu-zoom-in", () =>
        setZoom(zoomRef.current * MENU_STEP),
      ),
      listenToThisWindow("menu-zoom-out", () =>
        setZoom(zoomRef.current / MENU_STEP),
      ),
      listenToThisWindow("menu-zoom-reset", () => setZoom(1)),
    );

    return () => {
      window.removeEventListener("gesturestart", onGestureStart);
      window.removeEventListener("gesturechange", onGestureChange);
      window.removeEventListener("gestureend", onGestureEnd);
      window.removeEventListener("wheel", onWheel);
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(persistTimer);
      unregisterFlush();
      unlistenMenu();
    };
    // Mount-only: everything reactive comes in through the refs above.
  }, []);
}
