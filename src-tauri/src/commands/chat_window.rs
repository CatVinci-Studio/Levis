use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

/// Everything a detached chat window needs to carry on where the embedded
/// panel left off. `state` is opaque JSON: the actual shape is defined once,
/// in TypeScript (src/ai/chat/chat-bridge.ts), so the protocol doesn't have
/// to be kept in sync across two languages for a payload Rust never inspects.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatHandoff {
    /// Window label of the editor this chat belongs to. Every message the
    /// chat window sends is addressed here, and the editor stays the owner of
    /// pending edits - the chat never writes to a document itself.
    #[serde(rename = "editorLabel")]
    pub editor_label: String,
    pub state: serde_json::Value,
}

/// Handoffs waiting for their window's frontend to mount and claim them -
/// the same pattern as PendingDetachedTabs in tab_drag.rs, and drained the
/// same way (destructively, by window label).
pub struct PendingChatHandoffs(pub Mutex<HashMap<String, ChatHandoff>>);

/// Detached chat windows currently open, keyed by the editor that spawned
/// them, so an editor can tell whether its chat is already detached (and
/// focus it) instead of opening a second one.
pub struct OpenChatWindows(pub Mutex<HashMap<String, String>>);

/// Pops this chat out of the editor into a real OS window.
///
/// A native window, not a webview-drawn panel, is the whole point: the user
/// asked to be able to put it outside the main window, and only a real window
/// gets native edge/corner resizing, cross-monitor placement, and the
/// platform's own chrome.
#[tauri::command]
pub fn detach_chat_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: serde_json::Value,
    position: Option<(f64, f64)>,
    title: String,
    pending: State<PendingChatHandoffs>,
    open: State<OpenChatWindows>,
) -> Result<String, String> {
    let editor_label = window.label().to_string();

    // Already detached: focus what's there rather than spawning a duplicate
    // that would race the first one for the same editor's proposals.
    if let Some(existing) = open.0.lock().unwrap().get(&editor_label) {
        if let Some(win) = app.get_webview_window(existing) {
            let _ = win.set_focus();
            return Ok(existing.clone());
        }
    }

    let label = format!("chat-{}", crate::next_window_id());
    pending.0.lock().unwrap().insert(
        label.clone(),
        ChatHandoff {
            editor_label: editor_label.clone(),
            state,
        },
    );
    open.0.lock().unwrap().insert(editor_label, label.clone());

    let mut builder = WebviewWindowBuilder::new(
        &app,
        &label,
        // One bundle, one entry - the query string picks the chat view. A
        // second HTML entry point would mean a second build target and a
        // second copy of the shared providers for no gain.
        WebviewUrl::App("index.html?view=chat".into()),
    )
    .title(title)
    .inner_size(420.0, 560.0)
    .min_inner_size(320.0, 240.0);
    if let Some((x, y)) = position {
        builder = builder.position(x, y);
    }
    builder.build().map_err(|err| err.to_string())?;
    Ok(label)
}

/// Claimed once, by the chat window's frontend at mount.
#[tauri::command]
pub fn take_chat_handoff(
    window: tauri::Window,
    pending: State<PendingChatHandoffs>,
) -> Option<ChatHandoff> {
    pending.0.lock().unwrap().remove(window.label())
}

/// Closes the detached chat for this editor, if one is open - what the
/// editor calls when the user re-embeds the panel.
#[tauri::command]
pub fn close_chat_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    open: State<OpenChatWindows>,
) {
    let label = open.0.lock().unwrap().remove(window.label());
    if let Some(label) = label {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.close();
        }
    }
}

/// Drops a closed chat window's registration so the editor that owned it can
/// detach again. Called from the global window-destroyed handler, since the
/// window can also be closed by the user or by the OS.
pub fn forget_chat_window(label: &str, open: &OpenChatWindows) {
    let mut map = open.0.lock().unwrap();
    map.retain(|_, chat| chat != label);
    map.remove(label);
}
