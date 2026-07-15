import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

/// Document zoom, scoped to the editor CONTENT - the window chrome (tab
/// bar, titlebar filename, sidebar, toolbars) stays at 100%. The factor is
/// published as the `--content-zoom` CSS variable; App.css applies it as
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
const PERSIST_DELAY_MS = 400;

/// WebKit's proprietary pinch events (gesturestart/change/end) - not in
/// lib.dom because no other engine implements them.
interface WebKitGestureEvent extends UIEvent {
  readonly scale: number;
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

    const apply = () => {
      document.documentElement.style.setProperty("--content-zoom", String(zoomRef.current));
    };

    const applyFrame = () => {
      raf = 0;
      apply();
    };

    // `snapped: false` while a pinch is mid-flight, so the 100% snap zone
    // doesn't make the gesture feel sticky; the resting snap happens on
    // gestureend.
    const setZoom = (zoom: number, snapped = true) => {
      zoomRef.current = snapped ? snap(zoom) : clamp(zoom);
      if (!raf) raf = requestAnimationFrame(applyFrame);
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => persistRef.current(zoomRef.current), PERSIST_DELAY_MS);
    };

    if (zoomRef.current !== 1) apply();

    // Trackpad pinch: scale is cumulative from the gesture's start, so the
    // zoom at gesturestart is the base it multiplies.
    let pinchBase = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      pinchBase = zoomRef.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const { scale } = e as WebKitGestureEvent;
      if (scale > 0) setZoom(pinchBase * scale, false);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      setZoom(zoomRef.current);
    };

    // mod+wheel zoom (plain scrolling passes through untouched). The
    // exponential mapping makes steps proportional to the current level, so
    // zooming feels uniform at 60% and at 250%. Chromium also reports
    // trackpad pinch as ctrl+wheel, so this path covers pinch there too.
    const onWheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      setZoom(zoomRef.current * Math.exp(-e.deltaY * 0.0015));
    };

    window.addEventListener("gesturestart", onGestureStart);
    window.addEventListener("gesturechange", onGestureChange);
    window.addEventListener("gestureend", onGestureEnd);
    window.addEventListener("wheel", onWheel, { passive: false });

    const unlistenIn = listen("menu-zoom-in", () => setZoom(zoomRef.current * MENU_STEP));
    const unlistenOut = listen("menu-zoom-out", () => setZoom(zoomRef.current / MENU_STEP));
    const unlistenReset = listen("menu-zoom-reset", () => setZoom(1));

    return () => {
      window.removeEventListener("gesturestart", onGestureStart);
      window.removeEventListener("gesturechange", onGestureChange);
      window.removeEventListener("gestureend", onGestureEnd);
      window.removeEventListener("wheel", onWheel);
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(persistTimer);
      void unlistenIn.then((f) => f());
      void unlistenOut.then((f) => f());
      void unlistenReset.then((f) => f());
    };
    // Mount-only: everything reactive comes in through the refs above.
  }, []);
}
