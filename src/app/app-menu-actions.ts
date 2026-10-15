import { getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { EDIT_ACTION_EVENT } from "../utils/events";
import type { LocalMenuAction, NativeMenuId } from "./app-menu-model";
import { canToggleFullscreen } from "../platform/capabilities";

/**
 * The app-drawn menu's items that never had a native id to send.
 *
 * They were `PredefinedMenuItem`s in the native menu (Undo, Cut, Copy,
 * Paste, Select All, Toggle Full Screen) - muda generates their ids and
 * offers no way to fire one from outside a click, so `trigger_menu_item`
 * cannot reach them. Every one of them is already implemented on this side
 * anyway: the editing five are what the right-click menu runs (see
 * editor/useEditorClipboard.ts and the EDIT_ACTION_EVENT listener in
 * MilkdownEditor.tsx), and fullscreen is a window API call.
 */
export function runLocalMenuAction(action: LocalMenuAction): void {
  if (action === "fullscreen") {
    if (!canToggleFullscreen) return;
    void (async () => {
      const win = getCurrentWindow();
      await win.setFullscreen(!(await win.isFullscreen()));
    })();
    return;
  }
  window.dispatchEvent(new CustomEvent(EDIT_ACTION_EVENT, { detail: action }));
}

/**
 * iOS has no menu.rs, so this does its `dispatch` for the ids the phone
 * menu offers: turn the id into the window event useMenuBridge (and
 * useZoom) already listen for, and send it to this webview.
 */
export function emitMenuEvent(id: NativeMenuId): void {
  const [event, payload] = id.startsWith("help-doc:")
    ? ["menu-open-help", id.slice("help-doc:".length)]
    : id.startsWith("insert-block:")
      ? ["menu-insert-block", id.slice("insert-block:".length)]
      : [id === "settings" ? "menu-open-settings" : `menu-${id}`, undefined];
  // Addressed to the WebviewWindow, the form menu.rs's emit_to uses. A bare
  // label is AnyLabel, which on iOS - where the window and its webview are
  // both "main" - delivered the event twice, so every toggle undid itself.
  const { label } = getCurrentWebviewWindow();
  void emitTo({ kind: "WebviewWindow", label }, event, payload);
}
