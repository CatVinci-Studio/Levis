use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

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

/// One detached chat window.
///
/// The Agent has exactly two surfaces, and they differ in what they are ABOUT
/// (see src/ai/chat/InlineChat.tsx): the in-document Quick Ask bar is scoped
/// to the one file it was opened in, while a detached window is the
/// cross-file surface - it follows whatever document the user is editing and
/// pulls each new selection in. There is therefore at most ONE chat window
/// per scope: popping the chat out of a second file must reveal the window
/// already open, never spawn a rival one that would race it for the same
/// editor's proposals.
pub struct ChatWindowEntry {
    pub label: String,
    /// Which editors this chat serves. `Some(editor_label)` is the default -
    /// one chat per editor window, shared by all of that window's tabs.
    /// `None` means every editor window in the app, which is what the
    /// "share across windows" setting turns on.
    pub scope: Option<String>,
}

impl ChatWindowEntry {
    fn serves(&self, editor_label: &str) -> bool {
        match &self.scope {
            Some(owner) => owner == editor_label,
            None => true,
        }
    }
}

/// The editor window a detached chat belongs to, if `label` names one.
/// Menu commands focused on a chat window are routed here - the chat has no
/// document and no menu handlers, so delivering Save/Export/Find to it would
/// silently do nothing.
///
/// A cross-window chat (`scope: None`) has no fixed owner, so it resolves to
/// whichever editor window was focused most recently - the document the user
/// was last working in, which is also the one that chat is showing.
pub fn editor_for_chat(
    label: &str,
    open: &OpenChatWindows,
    last_active: &LastActiveEditor,
) -> Option<String> {
    let scope = open
        .0
        .lock()
        .unwrap()
        .iter()
        .find(|entry| entry.label == label)
        .map(|entry| entry.scope.clone())?;
    scope.or_else(|| last_active.0.lock().unwrap().clone())
}

/// Everything a detached chat window needs to carry on where the embedded
/// panel left off. `state` is opaque JSON: the actual shape is defined once,
/// in TypeScript (src/ai/chat/chat-bridge.ts), so the protocol doesn't have
/// to be kept in sync across two languages for a payload Rust never inspects.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatHandoff {
    /// Window label of the editor this chat belongs to. Only the STARTING
    /// address: once running, the chat re-addresses itself to whichever
    /// editor last pushed it context (see chat-bridge.ts), which is how one
    /// window can serve several files.
    #[serde(rename = "editorLabel")]
    pub editor_label: String,
    pub state: serde_json::Value,
}

/// Handoffs waiting for their window's frontend to mount and claim them -
/// the same pattern as PendingDetachedTabs in tab_drag.rs, and drained the
/// same way (destructively, by window label).
pub struct PendingChatHandoffs(pub Mutex<HashMap<String, ChatHandoff>>);

/// Detached chat windows currently open. A list rather than a map because
/// the key is a scope, and one of the two scope kinds (cross-window) has no
/// editor label to key on.
pub struct OpenChatWindows(pub Mutex<Vec<ChatWindowEntry>>);

/// The editor window focused most recently. Tracked because a cross-window
/// chat has no owning editor of its own - see `editor_for_chat`.
pub struct LastActiveEditor(pub Mutex<Option<String>>);

/// Called from the global window-focus handler. Chat windows and the drag
/// pill are ignored: "last active EDITOR" is the question being answered,
/// and focusing the chat itself must not erase which document it is about.
pub fn note_focused_window(label: &str, state: &LastActiveEditor) {
    if is_editor_window(label) {
        *state.0.lock().unwrap() = Some(label.to_string());
    }
}

/// The chat window serving `editor_label`, if one is open.
fn chat_serving(editor_label: &str, open: &OpenChatWindows) -> Option<String> {
    open.0
        .lock()
        .unwrap()
        .iter()
        .find(|entry| entry.serves(editor_label))
        .map(|entry| entry.label.clone())
}

/// Pops this chat out of the editor into a real OS window.
///
/// A native window, not a webview-drawn panel, is the whole point: the user
/// asked to be able to put it outside the main window, and only a real window
/// gets native edge/corner resizing, cross-monitor placement, and the
/// platform's own chrome.
///
/// `shared` is the "share across windows" setting: false gives this editor
/// window its own chat (shared by its tabs), true makes one chat window serve
/// every editor window in the app.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn detach_chat_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: serde_json::Value,
    position: Option<(f64, f64)>,
    title: String,
    shared: bool,
    pinned: bool,
    pending: State<PendingChatHandoffs>,
    open: State<OpenChatWindows>,
) -> Result<String, String> {
    let editor_label = window.label().to_string();

    let scope = (!shared).then(|| editor_label.clone());

    // Already open for this editor: focus what's there rather than spawning
    // a duplicate that would race the first one for the same proposals. This
    // is also the path a SECOND file takes - popping its chat out reveals the
    // one window, which then follows that file.
    if let Some(existing) = chat_serving(&editor_label, &open) {
        if let Some(win) = app.get_webview_window(&existing) {
            // The setting may have been toggled since this window opened, and
            // the entry was scoped from its value at that moment. Re-scope in
            // place rather than leaving the registry disagreeing with the
            // setting until the user closes the chat.
            let mut entries = open.0.lock().unwrap();
            if let Some(entry) = entries.iter_mut().find(|e| e.label == existing) {
                entry.scope = scope;
            }
            drop(entries);
            let _ = win.set_focus();
            return Ok(existing);
        }
        // Registered but gone (closed without the destroy handler running) -
        // drop the stale entry and fall through to building a fresh window.
        open.0.lock().unwrap().retain(|entry| entry.label != existing);
    }

    let label = format!("{CHAT_LABEL_PREFIX}{}", crate::next_window_id());
    pending.0.lock().unwrap().insert(
        label.clone(),
        ChatHandoff {
            editor_label: editor_label.clone(),
            state,
        },
    );
    open.0.lock().unwrap().push(ChatWindowEntry {
        label: label.clone(),
        scope,
    });

    let builder = WebviewWindowBuilder::new(
        &app,
        &label,
        // One bundle, one entry - the query string picks the chat view. A
        // second HTML entry point would mean a second build target and a
        // second copy of the shared providers for no gain.
        WebviewUrl::App("index.html?view=chat".into()),
    )
    .title(title)
    .inner_size(420.0, 560.0)
    .min_inner_size(320.0, 240.0)
    // Set at build time as well as from the frontend so a pinned chat never
    // flashes behind the editor for the frame before its React mounts.
    .always_on_top(pinned);
    // Same chrome as the editor windows: the app draws its own top row rather
    // than sitting under a native title bar with a second row of ours beneath
    // it - on a 420px-wide panel that second row was most of the chrome.
    crate::with_app_chrome(builder, position)
        .build()
        .map_err(|err| err.to_string())?;
    notify_chat_windows_changed(&app);
    Ok(label)
}

/// The chat window serving the calling editor window, if any.
///
/// Editor windows call this on mount and on focus. It is the only way a
/// window that never detached anything itself can learn the label to push
/// context to - which is exactly the cross-window case, where the chat was
/// opened from a different window entirely.
#[tauri::command]
pub fn current_chat_window(
    window: tauri::WebviewWindow,
    open: State<OpenChatWindows>,
) -> Option<String> {
    chat_serving(window.label(), &open)
}

/// Claimed once, by the chat window's frontend at mount.
#[tauri::command]
pub fn take_chat_handoff(
    window: tauri::Window,
    pending: State<PendingChatHandoffs>,
) -> Option<ChatHandoff> {
    pending.0.lock().unwrap().remove(window.label())
}

/// Closes the detached chat serving this editor, if one is open - what the
/// editor calls when the user re-embeds the panel.
#[tauri::command]
pub fn close_chat_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    open: State<OpenChatWindows>,
) {
    let Some(label) = chat_serving(window.label(), &open) else {
        return;
    };
    open.0.lock().unwrap().retain(|entry| entry.label != label);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
    notify_chat_windows_changed(&app);
}

/// Told to every editor window when the set of open chat windows changes, so
/// each webview can re-read `current_chat_window` instead of believing a
/// cache. Without it, a cross-window chat closed from window A leaves window
/// B pushing context at a destroyed label - silently, since an `emitTo` a
/// dead window is not an error.
pub const CHAT_WINDOWS_CHANGED: &str = "chat:windows-changed";

/// Drops registrations involving a destroyed window. Called from the global
/// window-destroyed handler for EVERY window, so it handles both directions:
/// a closed chat window drops its own entry (letting an editor detach again),
/// and a closed editor window drops the chat scoped to it. A cross-window
/// chat (`scope: None`) survives any single editor closing - it belongs to
/// the app, not to one window.
pub fn forget_chat_window(app: &tauri::AppHandle, label: &str, open: &OpenChatWindows) {
    if forget_entries(label, open) {
        notify_chat_windows_changed(app);
    }
}

/// The registry half on its own, so the bookkeeping is testable without an
/// AppHandle to emit through. Returns whether anything was actually dropped.
fn forget_entries(label: &str, open: &OpenChatWindows) -> bool {
    let mut entries = open.0.lock().unwrap();
    let before = entries.len();
    entries.retain(|entry| entry.label != label && entry.scope.as_deref() != Some(label));
    entries.len() != before
}

/// Announces the registry change to every editor window. Editor windows only:
/// a chat window has no cache to invalidate, and the drag pill has no
/// listeners at all.
pub fn notify_chat_windows_changed(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        if is_editor_window(&label) {
            let _ = window.emit(CHAT_WINDOWS_CHANGED, ());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry(entries: Vec<(&str, Option<&str>)>) -> OpenChatWindows {
        OpenChatWindows(Mutex::new(
            entries
                .into_iter()
                .map(|(label, scope)| ChatWindowEntry {
                    label: label.to_string(),
                    scope: scope.map(|s| s.to_string()),
                })
                .collect(),
        ))
    }

    fn last_active(label: Option<&str>) -> LastActiveEditor {
        LastActiveEditor(Mutex::new(label.map(|s| s.to_string())))
    }

    /// The window-classification bugs this predicate exists to prevent were
    /// all silent: a tab dropped on a chat window vanished, menu commands
    /// went nowhere, files opened into the void. Worth pinning down.
    #[test]
    fn editor_windows_are_those_holding_a_document() {
        assert!(is_editor_window("main"));
        assert!(is_editor_window("window-1"));
        assert!(is_editor_window("window-42"));
    }

    #[test]
    fn chat_and_pill_windows_are_not_editors() {
        assert!(!is_editor_window("chat-1"));
        assert!(!is_editor_window("chat-99"));
        assert!(!is_editor_window(crate::tab_drag::DRAG_PILL_LABEL));
    }

    #[test]
    fn detached_chat_labels_are_classified_as_chats() {
        // The label format detach_chat_window builds must keep matching the
        // prefix the predicate tests, or every guard silently stops working.
        let label = format!("{CHAT_LABEL_PREFIX}{}", 7);
        assert!(!is_editor_window(&label));
    }

    #[test]
    fn a_scoped_chat_resolves_back_to_the_editor_that_opened_it() {
        let open = registry(vec![("chat-1", Some("main")), ("chat-3", Some("window-2"))]);
        let last = last_active(Some("main"));
        assert_eq!(
            editor_for_chat("chat-3", &open, &last),
            Some("window-2".to_string())
        );
        assert_eq!(
            editor_for_chat("chat-1", &open, &last),
            Some("main".to_string())
        );
    }

    #[test]
    fn a_cross_window_chat_resolves_to_the_last_focused_editor() {
        // It has no owner by construction - routing a menu command to the
        // document the user was last in is the only answer that isn't a
        // guess.
        let open = registry(vec![("chat-1", None)]);
        assert_eq!(
            editor_for_chat("chat-1", &open, &last_active(Some("window-2"))),
            Some("window-2".to_string())
        );
        assert_eq!(editor_for_chat("chat-1", &open, &last_active(None)), None);
    }

    #[test]
    fn an_unknown_chat_resolves_to_no_editor() {
        let open = registry(vec![("chat-1", Some("main"))]);
        assert_eq!(
            editor_for_chat("chat-9", &open, &last_active(Some("main"))),
            None
        );
    }

    #[test]
    fn a_scoped_chat_serves_only_its_own_editor() {
        let open = registry(vec![("chat-1", Some("main"))]);
        assert_eq!(chat_serving("main", &open), Some("chat-1".to_string()));
        assert_eq!(chat_serving("window-2", &open), None);
    }

    #[test]
    fn a_cross_window_chat_serves_every_editor() {
        // This is what makes a second window's editor find the chat it never
        // opened, and therefore push its document into it.
        let open = registry(vec![("chat-1", None)]);
        assert_eq!(chat_serving("main", &open), Some("chat-1".to_string()));
        assert_eq!(chat_serving("window-7", &open), Some("chat-1".to_string()));
    }

    #[test]
    fn forgetting_clears_both_directions_of_the_mapping() {
        let open = registry(vec![("chat-1", Some("main")), ("chat-3", Some("window-2"))]);

        // A closed CHAT window drops its own entry, freeing its editor to
        // detach again.
        forget_entries("chat-1", &open);
        assert_eq!(chat_serving("main", &open), None);
        assert_eq!(chat_serving("window-2", &open), Some("chat-3".to_string()));

        // A closed EDITOR window drops the chat scoped to it.
        forget_entries("window-2", &open);
        assert_eq!(chat_serving("window-2", &open), None);
    }

    #[test]
    fn a_cross_window_chat_outlives_any_one_editor_closing() {
        let open = registry(vec![("chat-1", None)]);
        forget_entries("main", &open);
        assert_eq!(chat_serving("window-2", &open), Some("chat-1".to_string()));
    }

    #[test]
    fn only_editor_focus_updates_the_last_active_editor() {
        let last = last_active(Some("main"));
        note_focused_window("chat-1", &last);
        // Focusing the chat must not erase which document it is about.
        assert_eq!(*last.0.lock().unwrap(), Some("main".to_string()));
        note_focused_window("window-2", &last);
        assert_eq!(*last.0.lock().unwrap(), Some("window-2".to_string()));
    }
}
