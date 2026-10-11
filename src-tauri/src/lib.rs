//! App entry: window creation, the OS-open queue, and the Tauri builder
//! (state, plugins, command registration). The menu bar lives in menu.rs;
//! tabs dragged between windows in tab_drag.rs; everything invoked by the
//! frontend beyond that in commands/, ai/ and auth/.
//!
//! The same crate builds the desktop app and the iOS app. Everything about
//! OS windows - the menu bar, more than one window, window chrome, single
//! instance, tabs dragged between windows, the detached chat, the updater,
//! session restore, argv - exists on desktop only and is gated with
//! `#[cfg(desktop)]` (tauri-build sets `desktop` / `mobile` per target).
//! Ungated code is shared. docs/ios/code-map.zh.md has the map.

mod ai;
mod app_identity;
mod atomic;
mod auth;
mod commands;
mod distribution;
#[cfg(desktop)]
mod menu;
#[cfg(desktop)]
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
use commands::attachment::pick_attachment_file;
use commands::drafts::{
    clear_all_drafts, clear_draft_snapshot, save_draft_snapshot, take_draft_snapshots,
};
use commands::export::export_save_dialog;
use commands::fs::{
    file_mtime_ms, list_dir, migrate_draft_images, open_css_file_dialog, open_file_dialog,
    read_binary_file_base64, read_text_file, save_file_dialog, save_pasted_image, write_text_file,
};
use commands::image_host::upload_image;
use commands::themes::{delete_theme, load_theme_css, save_theme_css};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

#[cfg(desktop)]
use commands::cli::{cli_command_status, install_cli_command};
#[cfg(desktop)]
use commands::export::{
    detect_pandoc, export_pdf_native, export_via_pandoc, open_pandoc_install_page, reveal_in_dir,
};
#[cfg(desktop)]
use commands::prefs::{set_new_document_mode, set_restore_session_on_startup};
#[cfg(desktop)]
use commands::session::{cancel_session_quit, update_session_paths, SessionTabsState};
#[cfg(desktop)]
use std::collections::HashMap;
#[cfg(desktop)]
use std::sync::atomic::AtomicU32;
#[cfg(desktop)]
use tab_drag::{DragTrackers, PendingDetachedTabs};
#[cfg(desktop)]
use tauri::{EventTarget, WebviewUrl, WebviewWindowBuilder};

/// Each new window is a fresh, independent instance of the whole SPA (its
/// own React tree, own in-memory document state) - just like opening a new
/// browser tab to the same URL. Labels only need to be unique per window.
#[cfg(desktop)]
static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

#[cfg(desktop)]
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
#[cfg(desktop)]
pub(crate) static PENDING_SHOW_HELP: Mutex<Option<String>> = Mutex::new(None);

#[cfg(desktop)]
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

/// Park paths for the next window to drain (see take_pending_open_path(s),
/// which the frontend calls as it mounts).
fn queue_pending(app: &tauri::AppHandle, paths: Vec<String>) {
    app.state::<PendingOpenPaths>()
        .0
        .lock()
        .unwrap()
        .extend(paths);
}

#[cfg(desktop)]
pub(crate) fn queue_paths_to_open(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    let ui_ready = UI_READY.load(Ordering::Relaxed);

    if commands::prefs::read_new_document_mode(app) == "tab" {
        // Already running: hand the whole batch to ONE live window as tabs
        // instead of spawning a window per path. The focused window, not
        // whichever one webview_windows() happens to yield first (it's a
        // HashMap - the order is arbitrary), so the file lands where the
        // user is looking. Nothing is queued on this path: the receiving
        // window opens the paths straight from the event, and a leftover
        // queue entry would be opened a second time by the next window to
        // mount.
        let target = if ui_ready {
            menu::focused_editor_window(app)
        } else {
            None
        };
        if let Some(label) = target {
            let _ = app.emit_to(
                EventTarget::webview_window(&label),
                "open-paths-as-tabs",
                paths,
            );
            // The open came from outside (a file manager, a second launch),
            // so the window it landed in is probably behind something.
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            return;
        }
        // Still launching, or no window alive to receive them: park the whole
        // batch for the window that mounts next - the initial one, or the
        // fresh one opened here - which drains all of it as its own tabs.
        queue_pending(app, paths);
        if ui_ready {
            let _ = open_new_window(app);
        }
        return;
    }

    // "window" mode (default): unchanged - one queued file rides the initial
    // window while the app is still launching; everything else gets a
    // window of its own, which drains one path when its frontend mounts.
    let count = paths.len();
    queue_pending(app, paths);
    let extra_windows = if ui_ready { count } else { count - 1 };
    for _ in 0..extra_windows {
        let _ = open_new_window(app);
    }
}

/// iOS: one webview, no windows to open. Before it has mounted, the paths are
/// parked for it to drain (take_pending_open_path(s)); after, they are handed
/// straight over as tabs - the same event desktop's tab mode uses.
#[cfg(mobile)]
pub(crate) fn queue_paths_to_open(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if UI_READY.load(Ordering::Relaxed) {
        let _ = app.emit("open-paths-as-tabs", paths);
    } else {
        queue_pending(app, paths);
    }
}

/// Places a window, gives it this app's chrome, and builds it. Shared by
/// editor windows and the detached chat window so the platform cfgs live in
/// exactly one place - the two used to carry byte-identical copies of them.
///
/// The chrome is the same idea on both platforms - ONE top row, drawn by the
/// app (src/App.tsx's `.window-bar`) - but the platforms reach it from
/// opposite directions:
///
/// - macOS has a style for exactly this: an overlay title bar keeps the
///   window's native behaviour while letting the traffic lights float over
///   our own row.
/// - Windows and Linux have no equivalent, so the only way to stop stacking a
///   native title bar AND a native menu bar AND our row is to drop the native
///   frame entirely and draw the caption ourselves (src/ui/WindowControls.tsx).
///   On Windows tao keeps WS_SIZEBOX on undecorated windows and hit-tests the
///   border in its own WM_NCHITTEST, so edge resizing, Aero snap and
///   Win+Arrow all still work; on Linux tao hit-tests an undecorated window's
///   edges itself and starts a GTK resize drag (X11 and Wayland alike). Only
///   the painted frame is gone. Linux kept its frame until users reported the
///   result: a title bar, an English-only GTK menu bar (it is built once, in
///   English - the app-drawn menu is the localized one) and our row with the
///   document title, three strips deep.
///
/// The one window that never comes through here is the one tauri.conf.json
/// declares; `decorations: false` is set for it in tauri.windows.conf.json
/// and tauri.linux.conf.json, which Tauri merges over the base config on
/// those targets only.
#[cfg(desktop)]
pub(crate) fn build_with_app_chrome(
    builder: WebviewWindowBuilder<'_, tauri::Wry, tauri::AppHandle>,
    position: Option<(f64, f64)>,
) -> tauri::Result<tauri::WebviewWindow> {
    let mut builder = builder;
    if let Some((x, y)) = position {
        builder = builder.position(x, y);
    }
    // macOS-only API - the other platforms don't compile these methods at all.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    #[cfg(any(windows, target_os = "linux"))]
    let builder = builder.decorations(false);
    let window = builder.build()?;
    hide_native_menu_bar(&window);
    Ok(window)
}

/// Whether this process talks to a Wayland compositor rather than X11 (or
/// XWayland). Wayland has no client-side window positions and no
/// always-on-top, which the detached chat relies on elsewhere.
///
/// Answered once, by `detect_wayland` on the main thread at startup: GDK
/// panics when touched from any other thread, and the chat window is built
/// from an async command - asking GDK there killed the command, so the
/// detached chat never opened.
#[cfg(target_os = "linux")]
pub(crate) fn is_wayland() -> bool {
    WAYLAND.get().copied().unwrap_or_else(|| {
        // Not detected yet (it always is by the time a window opens): the
        // environment says the same thing in every normal setup.
        std::env::var_os("WAYLAND_DISPLAY").is_some()
            && std::env::var("GDK_BACKEND").map_or(true, |b| b.contains("wayland"))
    })
}

#[cfg(target_os = "linux")]
static WAYLAND: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

/// Main thread only (GDK); see `is_wayland`.
#[cfg(target_os = "linux")]
fn detect_wayland() {
    use gtk::prelude::*;
    let wayland = gtk::gdk::Display::default()
        .is_some_and(|display| display.type_().name() == "GdkWaylandDisplay");
    let _ = WAYLAND.set(wayland);
}

/// Takes the native menu BAR off a window without detaching its menu.
///
/// Windows and Linux, and the cfg here has to keep matching
/// `appDrawsWindowFrame` in src/ui/window-chrome.ts - that flag is what
/// decides whether the frontend draws the menu button this hides the menu
/// behind (macOS has the system menu bar and ignores this entirely).
///
/// Hiding rather than removing: on Windows `hide_menu` only unsets the menu
/// bar (muda's `SetMenu(hwnd, null)`) and leaves muda's window subclass in
/// place, which keeps the menu's accelerators firing - Tauri translates them
/// through a message hook that doesn't care whether the bar is visible.
/// `remove_menu` would take the accelerators with it. GTK is different: it
/// only activates the accelerator of a menu item that is drawable, so on
/// Linux a hidden bar's accelerators are dead, and the frontend handles
/// those keys itself (`ownsMenuAccelerators` in window-chrome.ts).
#[cfg(desktop)]
pub(crate) fn hide_native_menu_bar(window: &tauri::WebviewWindow) {
    #[cfg(any(windows, target_os = "linux"))]
    let _ = window.hide_menu();
    #[cfg(not(any(windows, target_os = "linux")))]
    let _ = window;
}

#[cfg(desktop)]
pub(crate) fn build_window(
    app: &tauri::AppHandle,
    label: &str,
    position: Option<(f64, f64)>,
) -> tauri::Result<()> {
    let (width, height) = commands::prefs::read_editor_window_size(app).unwrap_or((800.0, 600.0));
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(app_identity::APP_NAME)
        .inner_size(width, height)
        .min_inner_size(EDITOR_MIN_SIZE.0, EDITOR_MIN_SIZE.1);
    build_with_app_chrome(builder, position)?;
    Ok(())
}

/// Below this the app-drawn window bar's menu button, centred title and
/// caption buttons run into each other. Keep in step with the minWidth/
/// minHeight of the config window in tauri*.conf.json.
#[cfg(desktop)]
const EDITOR_MIN_SIZE: (f64, f64) = (480.0, 320.0);

#[cfg(desktop)]
pub(crate) fn open_new_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    build_window(app, &format!("window-{}", next_window_id()), None)
}

/// The files named on a command line: every argument after the program
/// name that isn't a flag. `levis notes.md` from a shell passes a path
/// relative to that shell's directory - which, for a second launch handed
/// over by single-instance, is not this process's own - while everything
/// downstream (tabs, recents, session) wants it absolute. Desktop launchers
/// already pass absolute paths, which `join` leaves as they are.
#[cfg(desktop)]
fn paths_from_argv(args: impl IntoIterator<Item = String>, cwd: &std::path::Path) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| cwd.join(&a).to_string_lossy().into_owned())
        .collect()
}

/// Everything the builder needs on desktop only: the updater and process
/// plugins, the window/tab/session state, window-lifecycle bookkeeping, and
/// a startup that handles argv, session restore, the CLI shim and the menu
/// bar. iOS has none of these - one webview, no menu, no argv, App Store
/// updates.
#[cfg(desktop)]
fn desktop_builder(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PendingDetachedTabs(Mutex::new(HashMap::new())))
        .manage(DragTrackers::default())
        .manage(SessionTabsState(Mutex::new(HashMap::new())))
        .manage(commands::chat_window::PendingChatHandoffs(Mutex::new(
            HashMap::new(),
        )))
        .manage(commands::chat_window::OpenChatWindows(Mutex::new(
            Vec::new(),
        )))
        .on_window_event(|window, event| {
            let app = window.app_handle();
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let no_other_windows = app
                    .webview_windows()
                    .keys()
                    .all(|label| label == window.label());
                if let Some(state) = app.try_state::<SessionTabsState>() {
                    // Windows/Linux exit when their final application window
                    // is destroyed. Preserve that last editor's snapshot, but
                    // not when another window (for example detached chat)
                    // keeps the process alive. macOS deliberately supports a
                    // windowless running state, so an ordinary final-window
                    // close there persists an empty session instead.
                    let preserve_last = cfg!(not(target_os = "macos")) && no_other_windows;
                    commands::session::forget_window(app, window.label(), &state, preserve_last);
                }
                if let Some(state) = app.try_state::<commands::chat_window::OpenChatWindows>() {
                    commands::chat_window::forget_chat_window(app, window.label(), &state);
                }
                // File > Quit is implemented as close() on every window so
                // dirty editors can still cancel. macOS otherwise stays alive
                // with no windows, so finish the successful quit explicitly
                // only after the final window has actually been destroyed.
                if no_other_windows && commands::session::app_quitting() {
                    app.exit(0);
                }
            }
            // Nothing else remembers a window's size between launches (the
            // undecorated Linux window gets no help from the desktop either).
            // Close, not Destroyed - by then the size can no longer be read.
            if matches!(event, tauri::WindowEvent::CloseRequested { .. })
                && commands::chat_window::is_editor_window(window.label())
            {
                commands::prefs::remember_editor_window_size(app, window);
            }
        })
        .setup(|app| {
            #[cfg(target_os = "linux")]
            detect_wayland();
            // Windows/Linux hand an associated file over as a plain argv
            // path (macOS uses the Opened run-event instead, handled below).
            // With no file to open, fall back to restoring last session's
            // documents (unless the user turned that off in Settings) -
            // this is also what makes an app-update relaunch (which passes
            // no args at all) reopen whatever was open before the update.
            let arg_paths = paths_from_argv(
                std::env::args(),
                &std::env::current_dir().unwrap_or_default(),
            );
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

            // Every window that already exists got its menu bar from the
            // set_menu inside install() just now, which is AFTER the point
            // build_with_app_chrome had to hide it: the config window never
            // goes through that helper at all, and the startup windows
            // queue_paths_to_open opened above did, back when there was no
            // menu yet to hide. One sweep here covers both.
            for (_, window) in app.webview_windows() {
                hide_native_menu_bar(&window);
            }

            // The config window is built before setup runs, so it can only
            // be resized after the fact; build_window covers the rest.
            if let (Some(main), Some((width, height))) = (
                app.get_webview_window("main"),
                commands::prefs::read_editor_window_size(app.handle()),
            ) {
                let _ = main.set_size(tauri::LogicalSize::new(width, height));
            }

            Ok(())
        })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Windows and Linux start a whole new process for every file opened
    // from the file manager - its own windows, settings and session file,
    // so "open in a tab" couldn't work and two processes wrote the same
    // session. Must be the first plugin: a second launch hands its argv to
    // the running instance here and exits before setting anything else up.
    // (macOS routes later opens to the running app itself; see
    // RunEvent::Opened below.) Release builds only, so a dev build can run
    // next to an installed Levis instead of forwarding to it.
    #[cfg(all(any(windows, target_os = "linux"), not(debug_assertions)))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        let paths = paths_from_argv(argv, std::path::Path::new(&cwd));
        if paths.is_empty() {
            // Launched again from the app menu or dock: a fresh window,
            // as a second process used to give.
            let _ = open_new_window(app);
        } else {
            queue_paths_to_open(app, paths);
        }
    }));
    let builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingOpenPaths(Mutex::new(Vec::new())));
    // Document access outside the app's own folder (plugins/levis-files).
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_levis_files::init());
    #[cfg(desktop)]
    let builder = desktop_builder(builder);
    builder
        // One handler list for both targets. Desktop-only commands carry
        // #[cfg(desktop)] and are simply not registered on iOS - the
        // frontend never calls them there (src/platform/capabilities.ts and
        // the desktop-only wrappers in src/ipc.ts).
        .invoke_handler(tauri::generate_handler![
            // Shared: desktop and iOS.
            take_pending_open_path,
            take_pending_open_paths,
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
            upload_image,
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
            crate::ai::workspace::ensure_global_agent_md,
            crate::ai::workspace::import_agent_skill,
            crate::ai::project::list_project_files,
            crate::ai::project::read_project_file,
            crate::ai::project::ensure_project_file,
            crate::ai::project::pick_text_files,
            crate::ai::project::learn_style,
            pick_attachment_file,
            set_provider_api_key,
            provider_api_key_status,
            clear_provider_api_key,
            set_custom_endpoint,
            custom_endpoint_status,
            clear_custom_endpoint,
            fetch_custom_models,
            test_custom_endpoint,
            export_save_dialog,
            save_draft_snapshot,
            take_draft_snapshots,
            clear_draft_snapshot,
            clear_all_drafts,
            distribution::app_distribution,
            // iOS only: rename and delete in the document list.
            #[cfg(mobile)]
            commands::documents::rename_entry,
            #[cfg(mobile)]
            commands::documents::delete_entry,
            // Desktop only: menus, windows, tab drag, detached chat, session
            // restore, the window-mode prefs mirror, the terminal command,
            // pandoc/PDF export, folder pickers and file-manager reveals.
            #[cfg(desktop)]
            take_pending_show_help,
            #[cfg(desktop)]
            menu::trigger_menu_item,
            #[cfg(desktop)]
            menu::list_recent_files,
            #[cfg(desktop)]
            tab_drag::take_detached_tab,
            #[cfg(desktop)]
            tab_drag::list_window_bounds,
            #[cfg(desktop)]
            tab_drag::start_window_drag_tracking,
            #[cfg(desktop)]
            tab_drag::start_floating_tab_drag,
            #[cfg(desktop)]
            commands::chat_window::detach_chat_window,
            #[cfg(desktop)]
            commands::chat_window::take_chat_handoff,
            #[cfg(desktop)]
            commands::chat_window::close_chat_window,
            #[cfg(desktop)]
            commands::chat_window::focus_chat_window,
            #[cfg(desktop)]
            commands::chat_window::current_chat_window,
            #[cfg(desktop)]
            set_new_document_mode,
            #[cfg(desktop)]
            set_restore_session_on_startup,
            #[cfg(desktop)]
            update_session_paths,
            #[cfg(desktop)]
            cancel_session_quit,
            #[cfg(desktop)]
            crate::ai::workspace::pick_workspace_root,
            #[cfg(desktop)]
            crate::ai::workspace::open_global_agent_dir,
            #[cfg(desktop)]
            cli_command_status,
            #[cfg(desktop)]
            install_cli_command,
            #[cfg(desktop)]
            detect_pandoc,
            #[cfg(desktop)]
            export_via_pandoc,
            #[cfg(desktop)]
            export_pdf_native,
            #[cfg(desktop)]
            open_pandoc_install_page,
            #[cfg(desktop)]
            reveal_in_dir,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // Finder "Open With"/double-click on an associated .md lands
            // here as an Apple open-documents event (macOS never passes
            // opened files via argv). iOS delivers "Open in Levis" from the
            // Files app the same way.
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event {
                // iOS hands over a security-scoped URL: kept as a URL, it is
                // read and written through plugins/levis-files, which opens
                // its scope. A plain path would be unreadable there.
                #[cfg(target_os = "ios")]
                let paths: Vec<String> = urls
                    .iter()
                    .filter(|url| url.scheme() == "file")
                    .map(|url| url.to_string())
                    .collect();
                #[cfg(not(target_os = "ios"))]
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();
                queue_paths_to_open(app_handle, paths);
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            let _ = (app_handle, event);
        });
}
