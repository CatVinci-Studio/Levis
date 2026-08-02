import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettings } from "../settings/SettingsContext";
import { useCloseOnOutsideClick } from "../utils/useCloseOnOutsideClick";
import { AppMenu } from "./AppMenu";
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
 * Opens the app menu, and owns everything about it that is not the menu
 * itself: where it is anchored, what dismisses it, and where focus goes
 * afterwards. AppMenu.tsx draws the items and says why they are drawn here
 * at all rather than popped as the real `Menu` through Rust.
 */
export function AppMenuButton() {
  const { t } = useSettings();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  // Whatever had focus when the menu opened - almost always the document.
  // The menu takes focus so the arrow keys work in it, and hands it straight
  // back on the way out, so using the menu never costs the user their caret.
  const focusOnClose = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setAnchor(null);
    focusOnClose.current?.focus();
    focusOnClose.current = null;
  }, []);

  // Deliberately wrapped round the button AS WELL as the menu (the same
  // shape QuickAskPendingBar's split button uses). The hook listens on
  // document in the capture phase, so a click on the button while the menu
  // is open would otherwise count as "outside": it would close the menu a
  // moment before the button's own onClick ran and reopened it, and the
  // button would appear not to close the menu at all.
  const ref = useCloseOnOutsideClick<HTMLDivElement>(close, true);

  if (!appDrawsWindowFrame) return null;

  return (
    <div ref={ref} className="window-menu-anchor">
      <button
        type="button"
        className="window-caption-button window-menu-button"
        aria-label={t.appMenu}
        title={t.appMenu}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(e) => {
          if (anchor) {
            close();
            return;
          }
          focusOnClose.current = document.activeElement as HTMLElement | null;
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor({ x: rect.left, y: rect.bottom + 2 });
        }}
      >
        <HamburgerIcon />
      </button>
      {anchor && <AppMenu x={anchor.x} y={anchor.y} onClose={close} />}
    </div>
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
