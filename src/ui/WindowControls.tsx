import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettings } from "../settings/SettingsContext";
import { windowIpc } from "../ipc";
import {
  HamburgerIcon,
  WindowCloseIcon,
  WindowMaximizeIcon,
  WindowMinimizeIcon,
  WindowRestoreIcon,
} from "./icons";
import { appDrawsWindowFrame } from "./window-chrome";
import "./window-controls.css";

/**
 * The pieces of the window frame the app draws when the OS no longer does -
 * Windows only today; see window-chrome.ts for why the two platforms differ.
 *
 * Both components render nothing at all where the platform still supplies
 * its own frame, so call sites can place them unconditionally and the macOS
 * title row stays byte-for-byte what it was.
 */

/**
 * Opens the app menu.
 *
 * Deliberately pops the REAL menu (Rust's `popup_app_menu` shows the same
 * `Menu` the menu bar was built from) rather than re-declaring seven
 * submenus in HTML. Every id, accelerator label, enabled state and handler
 * keeps working, and there is no second copy of the menu to drift from
 * src-tauri/src/menu.rs.
 */
export function AppMenuButton() {
  const { t } = useSettings();
  if (!appDrawsWindowFrame) return null;

  return (
    <button
      type="button"
      className="window-caption-button window-menu-button"
      aria-label={t.appMenu}
      title={t.appMenu}
      onClick={(e) => {
        // Anchor the popup under the button, in window-relative logical
        // points - which is what popup_menu_at expects. getBoundingClientRect
        // is already in CSS pixels relative to the viewport, and the webview
        // fills the window now that the frame is gone, so the two agree.
        const rect = e.currentTarget.getBoundingClientRect();
        void windowIpc.popupAppMenu(rect.left, rect.bottom);
      }}
    >
      <HamburgerIcon />
    </button>
  );
}

/**
 * Minimise / maximise / close.
 *
 * Close goes through `close()`, not `destroy()`, so it lands in the same
 * onCloseRequested handler the native button used to reach: the editor still
 * gets its unsaved-document prompt, and the detached chat still hands its
 * conversation back for re-embedding.
 */
export function WindowCaptionButtons() {
  const { t } = useSettings();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!appDrawsWindowFrame) return;
    const win = getCurrentWindow();
    let alive = true;
    const sync = () => {
      void win
        .isMaximized()
        .then((v) => {
          if (alive) setMaximized(v);
        })
        .catch(() => {
          // No backend (dev shim) - the glyph just stays on "maximize".
        });
    };
    sync();
    // Maximising is not the only way into the state: Aero snap, Win+Up and a
    // double-click on the drag region all get there without going through
    // the button below, and a stale glyph would offer "maximize" on an
    // already-maximized window.
    const unlisten = win.onResized(sync);
    return () => {
      alive = false;
      void unlisten.then((off) => off());
    };
  }, []);

  if (!appDrawsWindowFrame) return null;

  return (
    <div className="window-caption">
      <button
        type="button"
        className="window-caption-button"
        aria-label={t.windowMinimize}
        title={t.windowMinimize}
        onClick={() => void getCurrentWindow().minimize()}
      >
        <WindowMinimizeIcon />
      </button>
      <button
        type="button"
        className="window-caption-button"
        aria-label={maximized ? t.windowRestore : t.windowMaximize}
        title={maximized ? t.windowRestore : t.windowMaximize}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        {maximized ? <WindowRestoreIcon /> : <WindowMaximizeIcon />}
      </button>
      <button
        type="button"
        className="window-caption-button window-caption-close"
        aria-label={t.windowClose}
        title={t.windowClose}
        onClick={() => void getCurrentWindow().close()}
      >
        <WindowCloseIcon />
      </button>
    </div>
  );
}
