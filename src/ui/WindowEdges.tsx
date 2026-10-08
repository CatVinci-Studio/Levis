import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { drawsWindowEdges } from "./window-chrome";
import "./window-edges.css";

type ResizeDirection =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

const EDGES: ResizeDirection[] = [
  "North",
  "South",
  "East",
  "West",
  "NorthEast",
  "NorthWest",
  "SouthEast",
  "SouthWest",
];

/**
 * The frame an undecorated Linux window no longer gets from GTK (#11):
 * without decorations there is no shadow or border, so a white window
 * vanishes against white content behind it, and the only resize zone is
 * the runtime's thin built-in strip, whose cursor shows up only once the
 * button is already down. This draws a hairline outline and puts real
 * hit areas along the edges - hovering shows the resize cursor, pressing
 * hands the drag to the compositor (startResizeDragging), which also works
 * under Wayland, where a client cannot move its own edges.
 *
 * Both are dropped while the window fills the screen (maximized, tiled
 * full-size, fullscreen): there is nothing to outline or drag there.
 */
export function WindowEdges() {
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    if (!drawsWindowEdges) return;
    const win = getCurrentWindow();
    let alive = true;
    const sync = () => {
      void Promise.all([win.isMaximized(), win.isFullscreen()])
        .then(([maximized, fullscreen]) => {
          if (alive) setFilled(maximized || fullscreen);
        })
        .catch(() => {
          // No backend (dev shim) - keep the edges.
        });
    };
    sync();
    const unlisten = win.onResized(sync);
    return () => {
      alive = false;
      void unlisten.then((off) => off());
    };
  }, []);

  if (!drawsWindowEdges || filled) return null;

  return (
    <>
      <div className="window-edge-outline" aria-hidden="true" />
      {EDGES.map((edge) => (
        <div
          key={edge}
          className="window-edge"
          data-edge={edge}
          aria-hidden="true"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            void getCurrentWindow().startResizeDragging(edge);
          }}
        />
      ))}
    </>
  );
}
