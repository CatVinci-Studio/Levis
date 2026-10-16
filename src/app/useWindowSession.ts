import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { canUseWindows } from "../platform/capabilities";
import { session } from "../platform/ipc";
import type { DocTab } from "../document/doc-tabs";

/** The OS title names the document too: it is what the taskbar, Alt+Tab
 *  and window lists show, where every window read "Textus" before. */
export function useWindowTitle(activeTitle: string): void {
  useEffect(() => {
    if (!canUseWindows) return;
    void getCurrentWindow()
      .setTitle(`${activeTitle} - Textus`)
      .catch(() => {});
  }, [activeTitle]);
}

/**
 * Reports this window's on-disk tab paths to Rust so a relaunch (an app
 * update, a crash, or just quitting and reopening) can restore what was
 * open - see commands/session.rs. Untitled/unsaved tabs have no path and
 * are simply skipped; keyed on the joined path list (not `tabs` itself) so
 * content edits don't spam the round trip.
 */
export function useSessionPaths(tabs: DocTab[]): void {
  const sessionPathsKey = tabs.map((tab) => tab.path ?? "").join("\n");
  useEffect(() => {
    if (!canUseWindows) return;
    const paths = tabs
      .filter((tab) => tab.path)
      .map((tab) => tab.path as string);
    void session.updateSessionPaths(paths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionPathsKey]);
}
