import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { canToggleFullscreen } from "../platform/capabilities";
import { ZEN_MODE_EVENT } from "../utils/events";

/**
 * Zen mode: only the text. Sidebar, tab bar, AI panel and window-bar
 * readouts go away, the window goes fullscreen, and every paragraph but
 * the one being written dims (editor/modes/zen-focus-plugin.ts). Esc leaves.
 */
export function useZenMode() {
  const [zenMode, setZenMode] = useState(false);
  const toggleZenMode = useCallback(() => setZenMode((on) => !on), []);
  // In the commit itself, before paint: the text column's glide
  // (App.tsx's FlipOnChange) measures the layout this class makes.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("zen", zenMode);
  }, [zenMode]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(ZEN_MODE_EVENT, { detail: zenMode }));
    if (!zenMode || !canToggleFullscreen) return;
    const win = getCurrentWindow();
    // Leaving zen may come before isFullscreen() answers: then fullscreen
    // is never entered, rather than entered after the restore already ran.
    let left = false;
    let restore = false;
    void win.isFullscreen().then((already) => {
      if (already || left) return;
      restore = true;
      void win.setFullscreen(true);
    });
    return () => {
      left = true;
      if (restore) void win.setFullscreen(false);
    };
  }, [zenMode]);
  useEffect(() => {
    if (!zenMode) return;
    // Capture phase: the editor binds Escape itself (and marks the event
    // handled), so a bubbling listener never heard it. Anything on screen
    // that Escape should close first - a dialog, menu, Quick Ask, the find
    // bar - keeps it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.isComposing || e.keyCode === 229) return;
      if (
        document.querySelector(
          ':is([role="dialog"], [role="menu"], .inline-chat, .find-replace-bar, .context-menu):not([data-state="closing"] *, [data-state="closing"])',
        )
      )
        return;
      setZenMode(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [zenMode]);

  return { zenMode, setZenMode, toggleZenMode };
}
