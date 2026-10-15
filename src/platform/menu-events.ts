import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { NativeMenuId } from "../app/app-menu-model";

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
