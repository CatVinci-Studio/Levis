mod ai;
mod app_identity;
mod auth;
mod commands;

use ai::agent::ai_agent_message;
use ai::client::{ai_complete, ai_grammar_check, fetch_agent_models, set_ai_proxy};
use auth::api_key::{api_key_status, clear_api_key, set_api_key};
use auth::claude::{claude_auth_status, claude_login, claude_logout};
use auth::custom_endpoint::{
    clear_custom_endpoint, custom_endpoint_status, fetch_custom_models, set_custom_endpoint, test_custom_endpoint,
};
use auth::openai_codex::{codex_auth_status, codex_login, codex_logout};
use commands::fs::{
    file_mtime_ms, list_dir, open_css_file_dialog, open_file_dialog, pick_attachment_file, read_binary_file_base64,
    read_text_file, save_file_dialog, save_pasted_image, write_text_file,
};
use commands::cli::{cli_command_status, install_cli_command};
use commands::export::{
    detect_pandoc, export_save_dialog, export_via_pandoc, open_pandoc_install_page, reveal_in_dir,
};
use commands::prefs::{
    get_new_document_mode, get_restore_session_on_startup, set_new_document_mode, set_restore_session_on_startup,
};
use commands::session::{update_session_paths, SessionTabsState};
use commands::themes::{delete_theme, load_theme_css, save_theme_css};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{Emitter, EventTarget, Manager, State, WebviewUrl, WebviewWindowBuilder};

const SETTINGS_MENU_ID: &str = "settings";
const NEW_FILE_ID: &str = "new-file";
const OPEN_FILE_ID: &str = "open-file";
const SAVE_FILE_ID: &str = "save-file";
const SAVE_FILE_AS_ID: &str = "save-file-as";
const RECENT_CLEAR_ID: &str = "recent-clear";
/// Menu ids of File > Open Recent entries carry their path: "recent:<path>".
const RECENT_PREFIX: &str = "recent:";
const EXPORT_PDF_ID: &str = "export-pdf";
const EXPORT_HTML_ID: &str = "export-html";
/// Menu ids of pandoc-backed File > Export entries carry the pandoc writer
/// name: "export-pandoc:<format>".
const EXPORT_PANDOC_PREFIX: &str = "export-pandoc:";
const QUIT_ID: &str = "quit";
const CLOSE_TAB_ID: &str = "close-tab";
const CLOSE_WINDOW_ID: &str = "close-window";
const TOGGLE_SOURCE_MODE_ID: &str = "toggle-source-mode";
const TOGGLE_TYPEWRITER_MODE_ID: &str = "toggle-typewriter-mode";
const TOGGLE_SIDEBAR_ID: &str = "toggle-sidebar";
const ZOOM_IN_ID: &str = "zoom-in";
const ZOOM_OUT_ID: &str = "zoom-out";
const ZOOM_RESET_ID: &str = "zoom-reset";
const FIND_REPLACE_ID: &str = "find-replace";
const NEW_WINDOW_ID: &str = "new-window";
/// Help menu ids carry the bundled doc they open: "help-doc:<doc>", where
/// <doc> is the frontend's HelpDoc id ("markdown" | "agent").
const HELP_DOC_PREFIX: &str = "help-doc:";
/// Format menu ids carry the block kind to insert: "insert-block:<kind>",
/// where <kind> is one of h1..h6, bullet-list, ordered-list, blockquote,
/// code-block, table - matching the frontend's INSERT_BLOCK_EVENT handler.
const INSERT_BLOCK_PREFIX: &str = "insert-block:";

/// Each new window is a fresh, independent instance of the whole SPA (its
/// own React tree, own in-memory document state) - just like opening a new
/// browser tab to the same URL. Labels only need to be unique per window.
static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

/// Files handed to the app from the OS (Finder "Open With", double-click on
/// an associated .md) queue up here; each window's frontend drains exactly
/// one on mount via `take_pending_open_path`. Queue-then-drain instead of an
/// event because the open request usually arrives before any webview has
/// mounted its listeners - an emit would vanish into the void.
struct PendingOpenPaths(Mutex<Vec<String>>);

/// Whether any window's frontend has mounted (= called
/// take_pending_open_path at least once). Before that, the config-defined
/// initial window will drain the queue itself; after it, an OS open request
/// needs a fresh window per file.
static UI_READY: AtomicBool = AtomicBool::new(false);

/// A tab dragged out of the tab bar (Settings > General > tab mode):
/// unlike PendingOpenPaths, this carries live in-memory content, not just a
/// path - the tab may be an unsaved draft, or have edits that haven't hit
/// disk yet, and dragging it out must not lose that. Keyed by the specific
/// new window's label (not a shared queue) since it's a 1:1 handoff to the
/// one window spawned for it, not a batch any window could claim.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct DetachedTab {
    path: Option<String>,
    content: String,
    #[serde(rename = "savedContent")]
    saved_content: String,
    /// The source tab's disk-mtime snapshot, carried along so the receiving
    /// window's external-change detection keeps its baseline instead of
    /// re-adopting whatever is on disk after the drop.
    #[serde(rename = "diskMtime")]
    disk_mtime: Option<f64>,
    /// Bundled Help doc id ("markdown"/"agent") when the dragged tab is a
    /// Help document - keeps its title and per-doc dedupe working in the
    /// window it lands in.
    #[serde(rename = "helpDoc", default, skip_serializing_if = "Option::is_none")]
    help_doc: Option<String>,
}
struct PendingDetachedTabs(Mutex<HashMap<String, DetachedTab>>);

/// A Help menu doc clicked while no window could receive the event: the
/// fresh window spawned for it drains this on mount, same queue-then-drain
/// reasoning as PendingOpenPaths (an emit would fire before the new webview
/// mounts its listeners). The docs themselves are bundled in the frontend
/// (src/help/), so the doc id is all Rust needs to carry.
static PENDING_SHOW_HELP: Mutex<Option<String>> = Mutex::new(None);

#[tauri::command]
fn take_pending_show_help() -> Option<String> {
    PENDING_SHOW_HELP.lock().unwrap().take()
}

#[tauri::command]
fn take_pending_open_path(pending: State<PendingOpenPaths>) -> Option<String> {
    UI_READY.store(true, Ordering::Relaxed);
    let mut paths = pending.0.lock().unwrap();
    if paths.is_empty() {
        None
    } else {
        Some(paths.remove(0))
    }
}

/// Tab-mode counterpart to take_pending_open_path: drains the whole queue at
/// once so a single window can open every pending path as its own tab,
/// instead of one window claiming just the first path off the front.
#[tauri::command]
fn take_pending_open_paths(pending: State<PendingOpenPaths>) -> Vec<String> {
    UI_READY.store(true, Ordering::Relaxed);
    let mut paths = pending.0.lock().unwrap();
    std::mem::take(&mut *paths)
}

fn queue_paths_to_open(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    let ui_ready = UI_READY.load(Ordering::Relaxed);

    if commands::prefs::read_new_document_mode(app) == "tab" {
        {
            let pending = app.state::<PendingOpenPaths>();
            pending.0.lock().unwrap().extend(paths.clone());
        }
        if !ui_ready {
            // The about-to-mount initial window will drain every queued path
            // as its own tab - no extra windows needed.
            return;
        }
        // Already running: hand the whole batch to a live window as tabs
        // instead of spawning one window per path. Only fall back to a fresh
        // window if there's truly nothing to receive them.
        if let Some((label, _)) = app.webview_windows().iter().find(|(label, _)| *label != DRAG_PILL_LABEL) {
            let _ = app.emit_to(EventTarget::webview_window(label), "open-paths-as-tabs", paths);
        } else {
            let _ = open_new_window(app);
        }
        return;
    }

    // "window" mode (default): unchanged - one queued file rides the initial
    // window while the app is still launching; everything else gets a
    // window of its own, which drains one path when its frontend mounts.
    let count = paths.len();
    {
        let pending = app.state::<PendingOpenPaths>();
        pending.0.lock().unwrap().extend(paths);
    }
    let extra_windows = if ui_ready { count } else { count - 1 };
    for _ in 0..extra_windows {
        let _ = open_new_window(app);
    }
}

/// Emit a menu event only to the focused window - each window is an
/// independent document, so broadcast semantics would e.g. save every
/// window's document at once. Deliberately `emit_to` (scoped to one
/// webview), not `emit` on a `Window`/`WebviewWindow` handle - the latter
/// looks scoped but actually broadcasts to every window app-wide, same as
/// calling `emit` on the `AppHandle` itself (both go through the same
/// manager-wide `Emitter::emit`; only `emit_to`/`emit_filter` actually
/// target a specific webview).
fn emit_to_focused(app: &tauri::AppHandle, event: &str) {
    emit_to_focused_payload(app, event, ());
}

fn emit_to_focused_payload<S: serde::Serialize + Clone>(app: &tauri::AppHandle, event: &str, payload: S) {
    if let Some((label, _)) = app.webview_windows().iter().find(|(_, w)| w.is_focused().unwrap_or(false)) {
        let _ = app.emit_to(EventTarget::webview_window(label), event, payload);
    }
}

/// Handle to the File > Open Recent submenu, kept so add_recent_file can
/// rebuild its entries at runtime without touching the rest of the menu.
struct RecentMenu(Mutex<Option<Submenu<tauri::Wry>>>);

fn abbreviate_home(path: &str) -> String {
    if let Ok(home) = std::env::var("HOME") {
        if let Some(rest) = path.strip_prefix(&home) {
            return format!("~{rest}");
        }
    }
    path.to_string()
}

/// Replace the Open Recent submenu's entries with `list` (most recent
/// first). Menus may only be mutated on the main thread, and the caller
/// may be a command on any thread - hence the hop.
pub(crate) fn rebuild_recent_menu(app: &tauri::AppHandle, list: Vec<String>) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        let Some(state) = app.try_state::<RecentMenu>() else { return };
        let guard = state.0.lock().unwrap();
        let Some(submenu) = guard.as_ref() else { return };
        if let Ok(items) = submenu.items() {
            for item in items {
                let _ = submenu.remove(&item);
            }
        }
        if list.is_empty() {
            if let Ok(item) = MenuItemBuilder::with_id("recent-none", "No Recent Files").enabled(false).build(&app) {
                let _ = submenu.append(&item);
            }
            return;
        }
        for path in &list {
            if let Ok(item) = MenuItemBuilder::with_id(format!("{RECENT_PREFIX}{path}"), abbreviate_home(path)).build(&app) {
                let _ = submenu.append(&item);
            }
        }
        if let Ok(sep) = PredefinedMenuItem::separator(&app) {
            let _ = submenu.append(&sep);
        }
        if let Ok(item) = MenuItemBuilder::with_id(RECENT_CLEAR_ID, "Clear Menu").build(&app) {
            let _ = submenu.append(&item);
        }
    });
}

fn build_window(app: &tauri::AppHandle, label: &str, position: Option<(f64, f64)>) -> tauri::Result<()> {
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(app_identity::APP_NAME)
        .inner_size(800.0, 600.0);
    if let Some((x, y)) = position {
        builder = builder.position(x, y);
    }
    // The overlay title bar (traffic lights floating over the content) is a
    // macOS-only API - Linux/Windows don't compile these methods at all.
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    builder.build()?;
    Ok(())
}

fn open_new_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let id = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    build_window(app, &format!("window-{id}"), None)
}

#[tauri::command]
fn take_detached_tab(window: tauri::Window, pending: State<PendingDetachedTabs>) -> Option<DetachedTab> {
    pending.0.lock().unwrap().remove(window.label())
}

#[derive(serde::Serialize)]
struct WindowBounds {
    label: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    /// Physical-per-logical-pixel ratio, so the frontend can convert its own
    /// "the tab row is the top N logical pixels" constant into physical
    /// pixels for THIS SPECIFIC window (which may sit on a different-DPI
    /// display than the one being dragged from).
    #[serde(rename = "scaleFactor")]
    scale_factor: f64,
}

/// Physical-pixel screen bounds of every open window - lets a single-tab
/// window being dragged by its title bar (App.tsx's onMoved/tick effect)
/// spot the moment its cursor enters another window's tab row, which is
/// when it hands itself over to start_floating_tab_drag.
#[tauri::command]
fn list_window_bounds(app: tauri::AppHandle) -> Vec<WindowBounds> {
    app.webview_windows()
        .iter()
        .filter_map(|(label, window)| {
            // The floating drag pill is the thing BEING dragged, never a
            // drop target; a hidden window can't be one either.
            if label == DRAG_PILL_LABEL || !window.is_visible().unwrap_or(false) {
                return None;
            }
            let pos = window.outer_position().ok()?;
            let size = window.outer_size().ok()?;
            let scale_factor = window.scale_factor().ok()?;
            Some(WindowBounds { label: label.clone(), x: pos.x, y: pos.y, width: size.width, height: size.height, scale_factor })
        })
        .collect()
}

/// Windows that currently have a live drag-tracking thread (see
/// start_window_drag_tracking) - guards against spawning a second poller for
/// the same window when onMoved fires again before the first tick lands.
struct DragTrackers(Mutex<std::collections::HashSet<String>>);

/// The floating tab pill: while a tab is dragged between windows it exists
/// as this dedicated tiny always-on-top transparent window (a webview can't
/// paint outside its own window, so the in-flight tab has to BE a window).
/// One per app, created fresh per drag (show_drag_pill) and destroyed on
/// release (destroy_drag_pill) - recreating is cheap (the page is a static
/// ~1KB dragpill.html) and passing title/dirty in the URL avoids any
/// eval-before-page-load race a persistent window would need to handle.
const DRAG_PILL_LABEL: &str = "drag-pill";
#[cfg(target_os = "macos")]
const DRAG_PILL_WIDTH: f64 = 200.0;
#[cfg(target_os = "macos")]
const DRAG_PILL_HEIGHT: f64 = 34.0;

/// Percent-encode a URL query value (std has no urlencoder; this is the
/// RFC 3986 unreserved set, byte-wise, so any title round-trips).
#[cfg(target_os = "macos")]
fn url_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Create the floating pill centered under the cursor (x/y in global
/// logical points), like a tab held by its middle. Click-through
/// (set_ignore_cursor_events) so it never swallows pointer events, never
/// focused so it never steals keyboard focus. Window creation must happen
/// on the main thread on macOS, and the drag thread isn't one; hence the
/// run_on_main_thread hop.
#[cfg(target_os = "macos")]
fn create_drag_pill(app: &tauri::AppHandle, title: &str, dirty: bool, x: f64, y: f64) {
    let url = format!("dragpill.html?title={}&dirty={}", url_encode(title), if dirty { 1 } else { 0 });
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if let Some(existing) = app.get_webview_window(DRAG_PILL_LABEL) {
            let _ = existing.destroy();
        }
        let built = WebviewWindowBuilder::new(&app, DRAG_PILL_LABEL, WebviewUrl::App(url.into()))
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .shadow(false)
            .inner_size(DRAG_PILL_WIDTH, DRAG_PILL_HEIGHT)
            .position(x - DRAG_PILL_WIDTH / 2.0, y - DRAG_PILL_HEIGHT / 2.0)
            .build();
        if let Ok(window) = built {
            let _ = window.set_ignore_cursor_events(true);
        }
    });
}

/// Reposition the pill under the cursor mid-drag; also re-shows it after a
/// park_drag_pill (leaving a tab row un-merged puts the pill back in hand).
#[cfg(target_os = "macos")]
fn move_drag_pill(app: &tauri::AppHandle, x: f64, y: f64) {
    if let Some(window) = app.get_webview_window(DRAG_PILL_LABEL) {
        let _ = window.set_position(tauri::LogicalPosition::new(x - DRAG_PILL_WIDTH / 2.0, y - DRAG_PILL_HEIGHT / 2.0));
        let _ = window.show();
    }
}

/// Hide (don't destroy) the pill while the cursor is over a target tab row:
/// the target shows the preview pill IN its bar instead, so the tab visually
/// snaps into the row while the drag is still live.
#[cfg(target_os = "macos")]
fn park_drag_pill(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(DRAG_PILL_LABEL) {
        let _ = window.hide();
    }
}

/// The drag ended (merged, detached, or cancelled) - the pill must not
/// outlive it, also because a lingering hidden window would keep the app
/// alive after the last real window closes.
#[cfg(target_os = "macos")]
fn destroy_drag_pill(app: &tauri::AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if let Some(window) = app.get_webview_window(DRAG_PILL_LABEL) {
            let _ = window.destroy();
        }
    });
}

/// Height of the strip along a window's top edge that counts as its "tab
/// row" for drop purposes - the tab bar when it has one, or the title strip
/// of a single-tab window. Mirrors App.tsx's TAB_ROW_HEIGHT_LOGICAL.
#[cfg(target_os = "macos")]
const TAB_ROW_HEIGHT_LOGICAL: f64 = 60.0;

/// Which window's tab row (if any) is under the cursor (global logical
/// points). The pill itself and hidden windows are never targets; the drag
/// SOURCE deliberately is one - dropping a pulled-out tab back onto its own
/// window's row simply re-inserts it there.
#[cfg(target_os = "macos")]
fn top_strip_hit(app: &tauri::AppHandle, x: f64, y: f64) -> Option<String> {
    for (label, window) in app.webview_windows() {
        if label == DRAG_PILL_LABEL || !window.is_visible().unwrap_or(false) {
            continue;
        }
        let (Ok(pos), Ok(size), Ok(scale)) = (window.outer_position(), window.outer_size(), window.scale_factor())
        else {
            continue;
        };
        let wx = pos.x as f64 / scale;
        let wy = pos.y as f64 / scale;
        let ww = size.width as f64 / scale;
        if x >= wx && x <= wx + ww && y >= wy && y <= wy + TAB_ROW_HEIGHT_LOGICAL {
            return Some(label);
        }
    }
    None
}

/// One floating tab drag at a time, app-wide - there's only one mouse.
#[cfg(target_os = "macos")]
static FLOATING_DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);

/// THE floating tab. The moment a tab becomes "in flight" - pulled past a
/// tab bar's detach threshold, or a whole single-tab window dragged onto
/// another window's tab row - its document is handed to Rust and its
/// source ceases to exist (the caller removes the pill from its bar, or
/// destroy_source tears the whole window down; destroy is the one window
/// operation macOS reliably honors mid-native-drag, unlike hide, which the
/// drag session ignores). From here this thread owns the drag outright,
/// polling the real cursor/button (see mod mouse): over a tab row, the
/// tab rides that row as the preview pill (the floating pill parks);
/// elsewhere it rides the cursor as the pill (created lazily the first
/// time it's actually needed). Release resolves it: over a row -> pushed
/// to that window as a real tab; anywhere else -> a fresh window right
/// there, via the same PendingDetachedTabs handoff a tab-bar detach has
/// always used. Nothing polls outside an active drag, and the thread ends
/// itself on release.
#[tauri::command]
fn start_floating_tab_drag(
    window: tauri::WebviewWindow,
    tab: DetachedTab,
    title: String,
    dirty: bool,
    destroy_source: bool,
) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, tab, title, dirty, destroy_source);
        Err("floating tab drags require macOS cursor tracking".to_string())
    }
    #[cfg(target_os = "macos")]
    {
        if FLOATING_DRAG_ACTIVE.swap(true, Ordering::SeqCst) {
            return Err("a floating tab drag is already active".to_string());
        }
        let app = window.app_handle().clone();
        if destroy_source {
            let _ = window.destroy();
        }
        std::thread::spawn(move || {
            let mut pill_exists = false;
            let mut pill_parked = false;
            let mut hover: Option<String> = None;
            let mut hit: Option<String> = None;
            let mut ticks: u32 = 0;

            let (x, y, final_hit) = loop {
                let (x, y, down) = mouse::state();
                if !down {
                    // Release: one fresh hit test decides - the cached one
                    // may be up to two ticks stale.
                    break (x, y, top_strip_hit(&app, x, y));
                }
                // Pill movement wants near-pointer-rate smoothness; the hit
                // test costs several event-loop round trips per window, so
                // it runs every 3rd tick and the last result stands between.
                if ticks.is_multiple_of(3) {
                    hit = top_strip_hit(&app, x, y);
                }
                ticks += 1;

                match &hit {
                    Some(label) => {
                        // Snapped into a row: the preview pill in the
                        // target's bar represents the tab now, the floating
                        // pill parks.
                        if pill_exists && !pill_parked {
                            park_drag_pill(&app);
                            pill_parked = true;
                        }
                        if hover.as_deref() != Some(label.as_str()) {
                            if let Some(prev) = &hover {
                                let _ = app.emit_to(
                                    EventTarget::webview_window(prev),
                                    "drag-hover",
                                    Option::<DragHoverPreview>::None,
                                );
                            }
                            hover = Some(label.clone());
                        }
                        // Every tick, not just on target change: the x is
                        // what lets the preview pill ride the cursor along
                        // the target's bar.
                        let _ = app.emit_to(
                            EventTarget::webview_window(label),
                            "drag-hover",
                            Some(DragHoverPreview { title: title.clone(), dirty, x }),
                        );
                    }
                    None => {
                        if let Some(prev) = hover.take() {
                            let _ =
                                app.emit_to(EventTarget::webview_window(&prev), "drag-hover", Option::<DragHoverPreview>::None);
                        }
                        if pill_exists {
                            move_drag_pill(&app, x, y);
                            pill_parked = false;
                        } else {
                            pill_exists = true;
                            pill_parked = false;
                            create_drag_pill(&app, &title, dirty, x, y);
                        }
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(15));
            };

            // A preview left on a window that ISN'T where the tab lands
            // gets an explicit off; the landing window's preview is
            // deliberately left alone - its receive-detached-tab listener
            // swaps it for the real tab without an empty-gap flash.
            if let Some(prev) = &hover {
                if final_hit.as_deref() != Some(prev.as_str()) {
                    let _ = app.emit_to(EventTarget::webview_window(prev), "drag-hover", Option::<DragHoverPreview>::None);
                }
            }
            match final_hit {
                Some(label) => {
                    let _ = app.emit_to(EventTarget::webview_window(&label), "receive-detached-tab", DroppedTab { tab, x });
                }
                None => {
                    let label = format!("window-{}", WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed));
                    app.state::<PendingDetachedTabs>().0.lock().unwrap().insert(label.clone(), tab);
                    let app2 = app.clone();
                    let position = (x - 100.0, (y - 14.0).max(0.0));
                    let _ = app.run_on_main_thread(move || {
                        let _ = build_window(&app2, &label, Some(position));
                    });
                }
            }
            destroy_drag_pill(&app);
            FLOATING_DRAG_ACTIVE.store(false, Ordering::SeqCst);
        });
        Ok(())
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone, serde::Serialize)]
struct DragTick {
    x: f64,
    y: f64,
    down: bool,
}

/// Global cursor position (logical points, top-left origin - the same space
/// as the browser's PointerEvent.screenX/Y) and left-button state, via
/// CoreGraphics. Neither call needs Accessibility/Input Monitoring consent:
/// they read shared session state, they don't tap the event stream.
#[cfg(target_os = "macos")]
mod mouse {
    #[repr(C)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        // state_id 0 = kCGEventSourceStateCombinedSessionState, button 0 = left
        fn CGEventSourceButtonState(state_id: u32, button: u32) -> bool;
        fn CGEventCreate(source: *const std::ffi::c_void) -> *const std::ffi::c_void;
        fn CGEventGetLocation(event: *const std::ffi::c_void) -> CGPoint;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const std::ffi::c_void);
    }

    pub fn left_button_down() -> bool {
        unsafe { CGEventSourceButtonState(0, 0) }
    }

    pub fn state() -> (f64, f64, bool) {
        unsafe {
            let event = CGEventCreate(std::ptr::null());
            let loc = CGEventGetLocation(event);
            CFRelease(event);
            (loc.x, loc.y, CGEventSourceButtonState(0, 0))
        }
    }
}

/// Tauri's onMoved fires on every tick of a native window drag but there is
/// no "drag ended" event, and a merge decision made on anything short of the
/// actual button release is wrong (a debounce merges while the user is
/// merely holding still). So: the frontend calls this on the FIRST onMoved
/// of a drag, and a short-lived thread streams `window-drag-tick`
/// {x, y, down} events (cursor in global logical points) to the calling
/// window until the left button is truly released - the final tick carries
/// down=false. Lazy by construction: no thread exists outside an active
/// drag, and it exits itself on release. Returns false when there's nothing
/// to track (button already up - e.g. a programmatic setPosition fired
/// onMoved - or a non-macOS platform).
#[tauri::command]
fn start_window_drag_tracking(window: tauri::WebviewWindow, trackers: State<DragTrackers>) -> bool {
    #[cfg(target_os = "macos")]
    {
        if !mouse::left_button_down() {
            return false;
        }
        let label = window.label().to_string();
        if !trackers.0.lock().unwrap().insert(label.clone()) {
            return true; // already streaming to this window
        }
        let app = window.app_handle().clone();
        std::thread::spawn(move || {
            loop {
                // The window dies mid-drag when it turns into a floating
                // tab (start_floating_tab_drag destroys it) - that thread
                // owns the drag from there, this one is done.
                if app.get_webview_window(&label).is_none() {
                    break;
                }
                let (x, y, down) = mouse::state();
                let _ = app.emit_to(EventTarget::webview_window(&label), "window-drag-tick", DragTick { x, y, down });
                if !down {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(40));
            }
            app.state::<DragTrackers>().0.lock().unwrap().remove(&label);
        });
        true
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, trackers);
        false
    }
}

/// Payload of the "drag-hover" event a floating tab drag emits to the
/// window whose tab row it's currently over - re-emitted on every tick
/// with the live cursor x (global logical), so the receiver can render the
/// incoming tab as a real pill sliding along its bar with the cursor, its
/// neighbors giving way. Cleared with None on leave.
#[derive(Clone, serde::Serialize)]
struct DragHoverPreview {
    title: String,
    dirty: bool,
    x: f64,
}

/// Payload of "receive-detached-tab": the document plus where (cursor x,
/// global logical) it was dropped - the receiver derives the insertion
/// index from it, so the tab lands at the slot it was hovering, not at
/// the end of the bar.
#[derive(Clone, serde::Serialize)]
struct DroppedTab {
    #[serde(flatten)]
    tab: DetachedTab,
    x: f64,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PendingOpenPaths(Mutex::new(Vec::new())))
        .manage(PendingDetachedTabs(Mutex::new(HashMap::new())))
        .manage(DragTrackers(Mutex::new(std::collections::HashSet::new())))
        .manage(SessionTabsState(Mutex::new(HashMap::new())))
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let app = window.app_handle();
                if let Some(state) = app.try_state::<SessionTabsState>() {
                    commands::session::forget_window(app, window.label(), &state);
                }
            }
        })
        .setup(|app| {
            // Windows/Linux hand an associated file over as a plain argv
            // path (macOS uses the Opened run-event instead, handled below).
            // With no file to open, fall back to restoring last session's
            // documents (unless the user turned that off in Settings) -
            // this is also what makes an app-update relaunch (which passes
            // no args at all) reopen whatever was open before the update.
            let arg_paths: Vec<String> = std::env::args().skip(1).filter(|a| !a.starts_with('-')).collect();
            let startup_paths = if !arg_paths.is_empty() {
                arg_paths
            } else if commands::prefs::read_restore_session_on_startup(app.handle()) {
                commands::session::read_session_paths(app.handle())
            } else {
                Vec::new()
            };
            queue_paths_to_open(app.handle(), startup_paths);

            commands::cli::try_silent_install();

            let settings_item = MenuItemBuilder::with_id(SETTINGS_MENU_ID, "Settings…")
                .accelerator("Cmd+,")
                .build(app)?;

            // Custom Quit instead of the predefined one: quitting must give
            // every window's unsaved document its close-confirmation prompt,
            // so it goes through each window's normal close request rather
            // than exiting the process outright.
            let quit_item = MenuItemBuilder::with_id(QUIT_ID, format!("Quit {}", app_identity::APP_NAME))
                .accelerator("Cmd+Q")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, app_identity::APP_NAME)
                .about(None)
                .separator()
                .item(&settings_item)
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .item(&quit_item)
                .build()?;

            let new_file_item = MenuItemBuilder::with_id(NEW_FILE_ID, "New File").accelerator("Cmd+N").build(app)?;
            let open_file_item = MenuItemBuilder::with_id(OPEN_FILE_ID, "Open…").accelerator("Cmd+O").build(app)?;
            // Built empty here; rebuild_recent_menu below fills it from the
            // persisted list and keeps it current as files are opened.
            let open_recent_menu = SubmenuBuilder::new(app, "Open Recent").build()?;
            let save_file_item = MenuItemBuilder::with_id(SAVE_FILE_ID, "Save").accelerator("Cmd+S").build(app)?;
            let save_file_as_item = MenuItemBuilder::with_id(SAVE_FILE_AS_ID, "Save As…")
                .accelerator("Cmd+Shift+S")
                .build(app)?;
            let export_pdf_item = MenuItemBuilder::with_id(EXPORT_PDF_ID, "PDF…")
                .accelerator("Cmd+P")
                .build(app)?;
            let export_html_item = MenuItemBuilder::with_id(EXPORT_HTML_ID, "HTML…").build(app)?;
            let mut export_menu_builder = SubmenuBuilder::new(app, "Export")
                .item(&export_pdf_item)
                .item(&export_html_item)
                .separator();
            // Everything below converts through a user-installed pandoc
            // (commands/export.rs) - same format list Typora offers.
            for (format, label) in [
                ("docx", "Word (.docx)…"),
                ("odt", "OpenDocument (.odt)…"),
                ("rtf", "RTF…"),
                ("epub", "EPUB…"),
                ("latex", "LaTeX…"),
                ("mediawiki", "MediaWiki…"),
                ("rst", "reStructuredText…"),
                ("textile", "Textile…"),
                ("opml", "OPML…"),
            ] {
                let item = MenuItemBuilder::with_id(format!("{EXPORT_PANDOC_PREFIX}{format}"), label).build(app)?;
                export_menu_builder = export_menu_builder.item(&item);
            }
            let export_menu = export_menu_builder.build()?;

            // Cmd+W closes the current tab (not the window - see
            // CLOSE_WINDOW_ID below, which owns Cmd+Shift+W instead).
            let close_tab_item = MenuItemBuilder::with_id(CLOSE_TAB_ID, "Close Tab").accelerator("Cmd+W").build(app)?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_file_item)
                .item(&open_file_item)
                .item(&open_recent_menu)
                .separator()
                .item(&save_file_item)
                .item(&save_file_as_item)
                .separator()
                .item(&export_menu)
                .separator()
                .item(&close_tab_item)
                .build()?;

            app.manage(RecentMenu(Mutex::new(Some(open_recent_menu))));
            rebuild_recent_menu(app.handle(), commands::recents::read_recent_files(app.handle()));

            // No fixed accelerator - the combo is user-configurable and
            // handled by the frontend keydown dispatcher (see
            // toggle_source_mode_item's comment below for why).
            let find_replace_item = MenuItemBuilder::with_id(FIND_REPLACE_ID, "Find & Replace…").build(app)?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .separator()
                .item(&find_replace_item)
                .build()?;

            let mut format_menu_builder = SubmenuBuilder::new(app, "Format");
            for (kind, label) in [
                ("h1", "Heading 1"),
                ("h2", "Heading 2"),
                ("h3", "Heading 3"),
                ("h4", "Heading 4"),
                ("h5", "Heading 5"),
                ("h6", "Heading 6"),
            ] {
                let item = MenuItemBuilder::with_id(format!("{INSERT_BLOCK_PREFIX}{kind}"), label).build(app)?;
                format_menu_builder = format_menu_builder.item(&item);
            }
            format_menu_builder = format_menu_builder.separator();
            for (kind, label) in [
                ("bullet-list", "Bullet List"),
                ("ordered-list", "Numbered List"),
                ("blockquote", "Blockquote"),
                ("code-block", "Code Block"),
                ("table", "Table"),
            ] {
                let item = MenuItemBuilder::with_id(format!("{INSERT_BLOCK_PREFIX}{kind}"), label).build(app)?;
                format_menu_builder = format_menu_builder.item(&item);
            }
            let format_menu = format_menu_builder.build()?;

            // No fixed accelerators on these - their shortcuts are
            // user-configurable and handled by the frontend keydown
            // dispatcher (App.tsx), which reads the current bindings from
            // Settings. A native accelerator here would keep firing on the
            // default combo even after the user rebinds it.
            let toggle_source_mode_item =
                MenuItemBuilder::with_id(TOGGLE_SOURCE_MODE_ID, "Toggle Source Code Mode").build(app)?;
            let toggle_typewriter_mode_item =
                MenuItemBuilder::with_id(TOGGLE_TYPEWRITER_MODE_ID, "Toggle Typewriter Mode").build(app)?;
            let toggle_sidebar_item = MenuItemBuilder::with_id(TOGGLE_SIDEBAR_ID, "Toggle Sidebar").build(app)?;

            // Fixed OS-convention accelerators (like Cmd+S / Cmd+W), not
            // user-configurable ones - so unlike the items above they keep
            // native accelerators. Zoom itself is applied by the frontend
            // (utils/useZoom.ts), which also handles pinch and mod+wheel.
            let zoom_in_item = MenuItemBuilder::with_id(ZOOM_IN_ID, "Zoom In").accelerator("Cmd+=").build(app)?;
            let zoom_out_item = MenuItemBuilder::with_id(ZOOM_OUT_ID, "Zoom Out").accelerator("Cmd+-").build(app)?;
            let zoom_reset_item =
                MenuItemBuilder::with_id(ZOOM_RESET_ID, "Actual Size").accelerator("Cmd+0").build(app)?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&toggle_source_mode_item)
                .item(&toggle_typewriter_mode_item)
                .item(&toggle_sidebar_item)
                .separator()
                .item(&zoom_in_item)
                .item(&zoom_out_item)
                .item(&zoom_reset_item)
                .separator()
                .fullscreen()
                .build()?;

            let new_window_item = MenuItemBuilder::with_id(NEW_WINDOW_ID, "New Window")
                .accelerator("Cmd+T")
                .build(app)?;
            // Built manually (not the .close_window() predefined item) so it
            // doesn't own the OS-default Cmd+W accelerator - that's Close
            // Tab's now (see CLOSE_TAB_ID above).
            let close_window_item = MenuItemBuilder::with_id(CLOSE_WINDOW_ID, "Close Window")
                .accelerator("Cmd+Shift+W")
                .build(app)?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .item(&new_window_item)
                .separator()
                .minimize()
                .maximize()
                .separator()
                .item(&close_window_item)
                .separator()
                .bring_all_to_front()
                .build()?;

            let help_menu = SubmenuBuilder::new(app, "Help")
                .text(format!("{HELP_DOC_PREFIX}markdown"), "Markdown Guide")
                .text(format!("{HELP_DOC_PREFIX}agent"), "AI Agent Guide")
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &file_menu, &edit_menu, &format_menu, &view_menu, &window_menu, &help_menu])
                .build()?;
            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                let id = event.id();
                if id == SETTINGS_MENU_ID {
                    let _ = app_handle.emit("menu-open-settings", ());
                } else if id == NEW_FILE_ID {
                    // Honors the same Settings choice as opening files: a
                    // new tab in the focused window in tab mode, a fresh
                    // window otherwise (or when there's no window at all).
                    if app_handle.webview_windows().is_empty()
                        || commands::prefs::read_new_document_mode(app_handle) != "tab"
                    {
                        let _ = open_new_window(app_handle);
                    } else {
                        emit_to_focused(app_handle, "menu-new-file");
                    }
                } else if id == OPEN_FILE_ID {
                    let _ = app_handle.emit("menu-open-file", ());
                } else if id == SAVE_FILE_ID {
                    emit_to_focused(app_handle, "menu-save-file");
                } else if id == SAVE_FILE_AS_ID {
                    emit_to_focused(app_handle, "menu-save-file-as");
                } else if id == RECENT_CLEAR_ID {
                    commands::recents::clear_recent_files(app_handle);
                } else if id.as_ref().starts_with(RECENT_PREFIX) {
                    // Routes through the same queue as Finder/CLI opens, so
                    // it lands as a tab or a window per the user's setting.
                    let path = id.as_ref()[RECENT_PREFIX.len()..].to_string();
                    queue_paths_to_open(app_handle, vec![path]);
                } else if id == EXPORT_PDF_ID {
                    emit_to_focused(app_handle, "menu-export-pdf");
                } else if id == EXPORT_HTML_ID {
                    emit_to_focused(app_handle, "menu-export-html");
                } else if id.as_ref().starts_with(EXPORT_PANDOC_PREFIX) {
                    let format = id.as_ref()[EXPORT_PANDOC_PREFIX.len()..].to_string();
                    emit_to_focused_payload(app_handle, "menu-export-pandoc", format);
                } else if id == QUIT_ID {
                    // close() (not destroy()) so each frontend gets its
                    // close-requested prompt; the app exits once the last
                    // window actually closes.
                    for (_, window) in app_handle.webview_windows() {
                        let _ = window.close();
                    }
                } else if id.as_ref().starts_with(INSERT_BLOCK_PREFIX) {
                    let kind = id.as_ref()[INSERT_BLOCK_PREFIX.len()..].to_string();
                    emit_to_focused_payload(app_handle, "menu-insert-block", kind);
                } else if id == TOGGLE_SOURCE_MODE_ID {
                    let _ = app_handle.emit("menu-toggle-source-mode", ());
                } else if id == TOGGLE_TYPEWRITER_MODE_ID {
                    let _ = app_handle.emit("menu-toggle-typewriter-mode", ());
                } else if id == TOGGLE_SIDEBAR_ID {
                    let _ = app_handle.emit("menu-toggle-sidebar", ());
                } else if id == FIND_REPLACE_ID {
                    emit_to_focused(app_handle, "menu-find-replace");
                } else if id == ZOOM_IN_ID {
                    emit_to_focused(app_handle, "menu-zoom-in");
                } else if id == ZOOM_OUT_ID {
                    emit_to_focused(app_handle, "menu-zoom-out");
                } else if id == ZOOM_RESET_ID {
                    emit_to_focused(app_handle, "menu-zoom-reset");
                } else if id == CLOSE_TAB_ID {
                    emit_to_focused(app_handle, "menu-close-tab");
                } else if id == CLOSE_WINDOW_ID {
                    // close() (not destroy()) so the frontend's dirty-tab
                    // prompt still runs, same as the red traffic-light button.
                    if let Some((_, window)) = app_handle.webview_windows().iter().find(|(_, w)| w.is_focused().unwrap_or(false)) {
                        let _ = window.close();
                    }
                } else if id == NEW_WINDOW_ID {
                    let _ = open_new_window(app_handle);
                } else if id.as_ref().starts_with(HELP_DOC_PREFIX) {
                    // A help doc opens as a tab in the focused window; with
                    // no window to receive it (macOS keeps the app alive
                    // windowless), spawn one that drains the pending doc on
                    // mount.
                    let doc = id.as_ref()[HELP_DOC_PREFIX.len()..].to_string();
                    if app_handle.webview_windows().iter().any(|(label, _)| *label != DRAG_PILL_LABEL) {
                        emit_to_focused_payload(app_handle, "menu-open-help", doc);
                    } else {
                        *PENDING_SHOW_HELP.lock().unwrap() = Some(doc);
                        let _ = open_new_window(app_handle);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_open_path,
            take_pending_open_paths,
            take_pending_show_help,
            take_detached_tab,
            list_window_bounds,
            start_window_drag_tracking,
            start_floating_tab_drag,
            get_new_document_mode,
            set_new_document_mode,
            get_restore_session_on_startup,
            set_restore_session_on_startup,
            update_session_paths,
            commands::recents::add_recent_file,
            open_file_dialog,
            open_css_file_dialog,
            save_file_dialog,
            list_dir,
            read_text_file,
            file_mtime_ms,
            read_binary_file_base64,
            write_text_file,
            save_pasted_image,
            save_theme_css,
            load_theme_css,
            delete_theme,
            codex_login,
            codex_auth_status,
            codex_logout,
            claude_login,
            claude_auth_status,
            claude_logout,
            ai_complete,
            ai_grammar_check,
            ai_agent_message,
            fetch_agent_models,
            set_ai_proxy,
            crate::ai::workspace::load_agent_workspace,
            crate::ai::workspace::open_global_agent_dir,
            crate::ai::workspace::ensure_global_agent_md,
            crate::ai::workspace::import_agent_skill,
            pick_attachment_file,
            set_api_key,
            api_key_status,
            clear_api_key,
            set_custom_endpoint,
            custom_endpoint_status,
            clear_custom_endpoint,
            fetch_custom_models,
            test_custom_endpoint,
            cli_command_status,
            install_cli_command,
            detect_pandoc,
            export_via_pandoc,
            export_save_dialog,
            open_pandoc_install_page,
            reveal_in_dir
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // Finder "Open With"/double-click on an associated .md lands
            // here as an Apple open-documents event (macOS never passes
            // opened files via argv).
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();
                queue_paths_to_open(app_handle, paths);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app_handle, event);
        });
}
