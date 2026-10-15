import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettings } from "../settings/SettingsContext";
import { useCloseOnOutsideClick } from "../utils/hooks/useCloseOnOutsideClick";
import { AppMenu } from "./AppMenu";
import type { MenuChecks } from "./app-menu-model";
import {
  HamburgerIcon,
  WindowCloseIcon,
  WindowMaximizeIcon,
  WindowMinimizeIcon,
  WindowRestoreIcon,
} from "../ui/icons";
import { appDrawsWindowFrame } from "./window-chrome";
import { Presence } from "../ui/usePresence";
import { isIOSApp } from "../platform/capabilities";
import "./window-controls.css";

/**
 * The pieces of the window frame the app draws when the OS no longer does -
 * Windows and Linux; see window-chrome.ts for why they differ from macOS.
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
export function AppMenuButton({ checks }: { checks?: MenuChecks } = {}) {
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
  const ref = useCloseOnOutsideClick<HTMLDivElement>(
    close,
    true,
    anchor !== null,
  );

  // Windows and Linux, where the menu bar went with the OS frame - and the
  // iPhone, which never had one.
  if (!appDrawsWindowFrame && !isIOSApp) return null;

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
          if (isIOSApp) {
            // The phone: leave the editor, which takes the keyboard and the
            // system's "Paste | Format" bubble with it (that bubble belongs
            // to the selection and otherwise floats over the menu), and
            // don't hand focus back afterwards - it would only bring the
            // keyboard back up over whatever the menu just opened.
            (document.activeElement as HTMLElement | null)?.blur();
            focusOnClose.current = null;
          } else {
            focusOnClose.current = document.activeElement as HTMLElement | null;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor({ x: rect.left, y: rect.bottom + 2 });
        }}
      >
        <HamburgerIcon />
      </button>
      <Presence show={anchor !== null} exitMs={120}>
        {anchor && (
          <AppMenu x={anchor.x} y={anchor.y} onClose={close} checks={checks} />
        )}
      </Presence>
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
    // A drag-resize fires this every frame, and each sync is three IPC
    // round trips; only where the resize ends matters.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const unlisten = win.onResized(() => {
      clearTimeout(settle);
      settle = setTimeout(sync, 100);
    });
    return () => {
      alive = false;
      clearTimeout(settle);
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
