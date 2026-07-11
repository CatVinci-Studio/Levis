mod ai;
mod app_identity;
mod auth;
mod commands;

use ai::agent::ai_agent_message;
use ai::client::{ai_complete, ai_grammar_check};
use auth::api_key::{api_key_status, clear_api_key, set_api_key};
use auth::claude::{claude_auth_status, claude_login, claude_logout};
use auth::custom_endpoint::{
    clear_custom_endpoint, custom_endpoint_status, fetch_custom_models, set_custom_endpoint, test_custom_endpoint,
};
use auth::openai_codex::{codex_auth_status, codex_login, codex_logout};
use commands::fs::{
    list_dir, open_css_file_dialog, open_file_dialog, read_binary_file_base64, read_text_file, save_file_dialog,
    save_pasted_image, write_text_file,
};
use commands::themes::{delete_theme, load_theme_css, save_theme_css};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

const SETTINGS_MENU_ID: &str = "settings";
const OPEN_FILE_ID: &str = "open-file";
const SAVE_FILE_ID: &str = "save-file";
const EXPORT_PDF_ID: &str = "export-pdf";
const QUIT_ID: &str = "quit";
const TOGGLE_SOURCE_MODE_ID: &str = "toggle-source-mode";
const TOGGLE_TYPEWRITER_MODE_ID: &str = "toggle-typewriter-mode";
const TOGGLE_SIDEBAR_ID: &str = "toggle-sidebar";
const NEW_WINDOW_ID: &str = "new-window";

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

fn queue_paths_to_open(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    let ui_ready = UI_READY.load(Ordering::Relaxed);
    let count = paths.len();
    {
        let pending = app.state::<PendingOpenPaths>();
        pending.0.lock().unwrap().extend(paths);
    }
    // One queued file rides the initial window while the app is still
    // launching; everything else gets a window of its own, which drains one
    // path when its frontend mounts.
    let extra_windows = if ui_ready { count } else { count - 1 };
    for _ in 0..extra_windows {
        let _ = open_new_window(app);
    }
}

/// Emit a menu event only to the focused window - each window is an
/// independent document, so broadcast semantics would e.g. save every
/// window's document at once.
fn emit_to_focused(app: &tauri::AppHandle, event: &str) {
    if let Some((_, window)) = app.webview_windows().iter().find(|(_, w)| w.is_focused().unwrap_or(false)) {
        let _ = window.emit(event, ());
    }
}

fn open_new_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let id = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    let builder = WebviewWindowBuilder::new(app, format!("window-{id}"), WebviewUrl::App("index.html".into()))
        .title(app_identity::APP_NAME)
        .inner_size(800.0, 600.0);
    // The overlay title bar (traffic lights floating over the content) is a
    // macOS-only API - Linux/Windows don't compile these methods at all.
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    builder.build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PendingOpenPaths(Mutex::new(Vec::new())))
        .setup(|app| {
            // Windows/Linux hand an associated file over as a plain argv
            // path (macOS uses the Opened run-event instead, handled below).
            let arg_paths: Vec<String> = std::env::args().skip(1).filter(|a| !a.starts_with('-')).collect();
            queue_paths_to_open(app.handle(), arg_paths);

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

            let open_file_item = MenuItemBuilder::with_id(OPEN_FILE_ID, "Open…").accelerator("Cmd+O").build(app)?;
            let save_file_item = MenuItemBuilder::with_id(SAVE_FILE_ID, "Save").accelerator("Cmd+S").build(app)?;
            let export_pdf_item = MenuItemBuilder::with_id(EXPORT_PDF_ID, "Export as PDF…")
                .accelerator("Cmd+P")
                .build(app)?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&open_file_item)
                .item(&save_file_item)
                .separator()
                .item(&export_pdf_item)
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

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

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&toggle_source_mode_item)
                .item(&toggle_typewriter_mode_item)
                .item(&toggle_sidebar_item)
                .separator()
                .fullscreen()
                .build()?;

            let new_window_item = MenuItemBuilder::with_id(NEW_WINDOW_ID, "New Window")
                .accelerator("Cmd+T")
                .build(app)?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .item(&new_window_item)
                .separator()
                .minimize()
                .maximize()
                .separator()
                .close_window()
                .separator()
                .bring_all_to_front()
                .build()?;

            let help_menu = SubmenuBuilder::new(app, "Help").text("help", "Levis Help").build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
                .build()?;
            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                let id = event.id();
                if id == SETTINGS_MENU_ID {
                    let _ = app_handle.emit("menu-open-settings", ());
                } else if id == OPEN_FILE_ID {
                    let _ = app_handle.emit("menu-open-file", ());
                } else if id == SAVE_FILE_ID {
                    emit_to_focused(app_handle, "menu-save-file");
                } else if id == EXPORT_PDF_ID {
                    emit_to_focused(app_handle, "menu-export-pdf");
                } else if id == QUIT_ID {
                    // close() (not destroy()) so each frontend gets its
                    // close-requested prompt; the app exits once the last
                    // window actually closes.
                    for (_, window) in app_handle.webview_windows() {
                        let _ = window.close();
                    }
                } else if id == TOGGLE_SOURCE_MODE_ID {
                    let _ = app_handle.emit("menu-toggle-source-mode", ());
                } else if id == TOGGLE_TYPEWRITER_MODE_ID {
                    let _ = app_handle.emit("menu-toggle-typewriter-mode", ());
                } else if id == TOGGLE_SIDEBAR_ID {
                    let _ = app_handle.emit("menu-toggle-sidebar", ());
                } else if id == NEW_WINDOW_ID {
                    let _ = open_new_window(app_handle);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_open_path,
            open_file_dialog,
            open_css_file_dialog,
            save_file_dialog,
            list_dir,
            read_text_file,
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
            set_api_key,
            api_key_status,
            clear_api_key,
            set_custom_endpoint,
            custom_endpoint_status,
            clear_custom_endpoint,
            fetch_custom_models,
            test_custom_endpoint
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
