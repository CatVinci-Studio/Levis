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
    write_text_file,
};
use commands::themes::{delete_theme, load_theme_css, save_theme_css};
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};

const SETTINGS_MENU_ID: &str = "settings";
const OPEN_FILE_ID: &str = "open-file";
const TOGGLE_SOURCE_MODE_ID: &str = "toggle-source-mode";
const TOGGLE_TYPEWRITER_MODE_ID: &str = "toggle-typewriter-mode";
const TOGGLE_SIDEBAR_ID: &str = "toggle-sidebar";
const NEW_WINDOW_ID: &str = "new-window";

/// Each new window is a fresh, independent instance of the whole SPA (its
/// own React tree, own in-memory document state) - just like opening a new
/// browser tab to the same URL. Labels only need to be unique per window.
static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

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
        .setup(|app| {
            let settings_item = MenuItemBuilder::with_id(SETTINGS_MENU_ID, "Settings…")
                .accelerator("Cmd+,")
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
                .quit()
                .build()?;

            let open_file_item = MenuItemBuilder::with_id(OPEN_FILE_ID, "Open…").accelerator("Cmd+O").build(app)?;

            let file_menu = SubmenuBuilder::new(app, "File").item(&open_file_item).build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let toggle_source_mode_item = MenuItemBuilder::with_id(TOGGLE_SOURCE_MODE_ID, "Toggle Source Code Mode")
                .accelerator("Cmd+/")
                .build(app)?;
            let toggle_typewriter_mode_item =
                MenuItemBuilder::with_id(TOGGLE_TYPEWRITER_MODE_ID, "Toggle Typewriter Mode").build(app)?;
            let toggle_sidebar_item = MenuItemBuilder::with_id(TOGGLE_SIDEBAR_ID, "Toggle Sidebar")
                .accelerator("Cmd+\\")
                .build(app)?;

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
            open_file_dialog,
            open_css_file_dialog,
            save_file_dialog,
            list_dir,
            read_text_file,
            read_binary_file_base64,
            write_text_file,
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
