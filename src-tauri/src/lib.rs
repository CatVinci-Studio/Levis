//! App entry: window creation, the OS-open queue, and the Tauri builder
//! (state, plugins, command registration). The menu bar lives in menu.rs;
//! tabs dragged between windows in tab_drag.rs; everything invoked by the
//! frontend beyond that in commands/, ai/ and auth/.

mod ai;
mod app_identity;
mod atomic;
mod auth;
mod commands;
mod menu;
mod tab_drag;

use ai::agent::ai_agent_message;
use ai::cancel::ai_cancel;
use ai::client::{ai_complete, ai_grammar_check, fetch_agent_models, set_ai_proxy};
use auth::claude::{claude_auth_status, claude_login, claude_logout};
use auth::custom_endpoint::{
    clear_custom_endpoint, custom_endpoint_status, fetch_custom_models, set_custom_endpoint,
    test_custom_endpoint,
};
use auth::keys::{clear_provider_api_key, provider_api_key_status, set_provider_api_key};
use auth::openai_codex::{codex_auth_status, codex_login, codex_logout};
use commands::cli::{cli_command_status, install_cli_command};
use commands::drafts::{
    clear_all_drafts, clear_draft_snapshot, save_draft_snapshot, take_draft_snapshots,
};
use commands::export::{
    detect_pandoc, export_save_dialog, export_via_pandoc, open_pandoc_install_page, reveal_in_dir,
};
use commands::fs::{
    file_mtime_ms, list_dir, migrate_draft_images, open_css_file_dialog, open_file_dialog,
    pick_attachment_file, read_binary_file_base64, read_text_file, save_file_dialog,
    save_pasted_image, write_text_file,
};
use commands::prefs::{
    get_new_document_mode, get_restore_session_on_startup, set_new_document_mode,
    set_restore_session_on_startup,
};
use commands::session::{update_session_paths, SessionTabsState};
use commands::themes::{delete_theme, load_theme_css, save_theme_css};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, EventTarget, Manager, State, WebviewUrl, WebviewWindowBuilder};

use tab_drag::{DragTrackers, PendingDetachedTabs, DRAG_PILL_LABEL};

/// Each new window is a fresh, independent instance of the whole SPA (its
/// own React tree, own in-memory document state) - just like opening a new
/// browser tab to the same URL. Labels only need to be unique per window.
static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

pub(crate) fn next_window_id() -> u32 {
    WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed)
}

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

/// A Help menu doc clicked while no window could receive the event: the
/// fresh window spawned for it drains this on mount, same queue-then-drain
/// reasoning as PendingOpenPaths (an emit would fire before the new webview
/// mounts its listeners). The docs themselves are bundled in the frontend
/// (src/help/), so the doc id is all Rust needs to carry.
pub(crate) static PENDING_SHOW_HELP: Mutex<Option<String>> = Mutex::new(None);

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

pub(crate) fn queue_paths_to_open(app: &tauri::AppHandle, paths: Vec<String>) {
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
        if let Some((label, _)) = app
            .webview_windows()
            .iter()
            .find(|(label, _)| *label != DRAG_PILL_LABEL)
        {
            let _ = app.emit_to(
                EventTarget::webview_window(label),
                "open-paths-as-tabs",
                paths,
            );
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

pub(crate) fn build_window(
    app: &tauri::AppHandle,
    label: &str,
    position: Option<(f64, f64)>,
) -> tauri::Result<()> {
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(app_identity::APP_NAME)
        .inner_size(800.0, 600.0);
    if let Some((x, y)) = position {
        builder = builder.position(x, y);
    }
    // The overlay title bar (traffic lights floating over the content) is a
    // macOS-only API - Linux/Windows don't compile these methods at all.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    builder.build()?;
    Ok(())
}

pub(crate) fn open_new_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    build_window(app, &format!("window-{}", next_window_id()), None)
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
            let arg_paths: Vec<String> = std::env::args()
                .skip(1)
                .filter(|a| !a.starts_with('-'))
                .collect();
            let startup_paths = if !arg_paths.is_empty() {
                arg_paths
            } else if commands::prefs::read_restore_session_on_startup(app.handle()) {
                commands::session::read_session_paths(app.handle())
            } else {
                Vec::new()
            };
            queue_paths_to_open(app.handle(), startup_paths);

            commands::cli::try_silent_install();

            menu::install(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_open_path,
            take_pending_open_paths,
            take_pending_show_help,
            tab_drag::take_detached_tab,
            tab_drag::list_window_bounds,
            tab_drag::start_window_drag_tracking,
            tab_drag::start_floating_tab_drag,
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
            migrate_draft_images,
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
            ai_cancel,
            fetch_agent_models,
            set_ai_proxy,
            crate::ai::catalog::list_providers,
            crate::ai::workspace::load_agent_workspace,
            crate::ai::workspace::open_global_agent_dir,
            crate::ai::workspace::ensure_global_agent_md,
            crate::ai::workspace::import_agent_skill,
            pick_attachment_file,
            set_provider_api_key,
            provider_api_key_status,
            clear_provider_api_key,
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
            reveal_in_dir,
            save_draft_snapshot,
            take_draft_snapshots,
            clear_draft_snapshot,
            clear_all_drafts
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
