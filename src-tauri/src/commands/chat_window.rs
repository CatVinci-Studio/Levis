use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

/// Label prefix of every detached chat window. Window-enumeration code has
/// to be able to tell these apart from editor windows: a chat window has no
/// tab bar and no document, so offering it as a tab-drag drop target or
/// handing it files to open would silently lose whatever was sent.
pub const CHAT_LABEL_PREFIX: &str = "chat-";

/// Whether `label` names a window that hosts a document (i.e. not the drag
/// pill and not a detached chat).
pub fn is_editor_window(label: &str) -> bool {
    label != crate::tab_drag::DRAG_PILL_LABEL && !label.starts_with(CHAT_LABEL_PREFIX)
}

/// The editor window a detached chat belongs to, if `label` names one.
/// Menu commands focused on a chat window are routed here - the chat has no
/// document and no menu handlers, so delivering Save/Export/Find to it would
/// silently do nothing.
pub fn editor_for_chat(label: &str, open: &OpenChatWindows) -> Option<String> {
    open.0
        .lock()
        .unwrap()
        .iter()
        .find(|(_, chat)| chat.as_str() == label)
        .map(|(editor, _)| editor.clone())
}

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

    let label = format!("{CHAT_LABEL_PREFIX}{}", crate::next_window_id());
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

/// Drops registrations involving a destroyed window. Called from the global
/// window-destroyed handler for EVERY window, so it handles both directions
/// of the editor -> chat mapping: a closed chat window is removed by value
/// (letting its editor detach again), and a closed editor window is removed
/// by key (so its entry doesn't outlive it).
pub fn forget_chat_window(label: &str, open: &OpenChatWindows) {
    let mut map = open.0.lock().unwrap();
    map.retain(|_, chat| chat != label);
    map.remove(label);
}
