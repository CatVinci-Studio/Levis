mod ai;
mod app_identity;
mod auth;
mod commands;

use ai::agent::ai_agent_message;
use ai::client::{ai_chat, ai_complete, ai_grammar_check};
use auth::api_key::{api_key_status, clear_api_key, set_api_key};
use auth::claude::{claude_auth_status, claude_login, claude_logout};
use auth::custom_endpoint::{
    clear_custom_endpoint, custom_endpoint_status, fetch_custom_models, set_custom_endpoint, test_custom_endpoint,
};
use auth::openai_codex::{codex_auth_status, codex_login, codex_logout};
use commands::fs::{list_dir, open_file_dialog, read_text_file, save_file_dialog, write_text_file};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;

const SETTINGS_MENU_ID: &str = "settings";
const TOGGLE_SOURCE_MODE_ID: &str = "toggle-source-mode";
const TOGGLE_TYPEWRITER_MODE_ID: &str = "toggle-typewriter-mode";
const TOGGLE_SIDEBAR_ID: &str = "toggle-sidebar";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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

            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .separator()
                .close_window()
                .separator()
                .bring_all_to_front()
                .build()?;

            let help_menu = SubmenuBuilder::new(app, "Help").text("help", "Levis Help").build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
                .build()?;
            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                let id = event.id();
                if id == SETTINGS_MENU_ID {
                    let _ = app_handle.emit("menu-open-settings", ());
                } else if id == TOGGLE_SOURCE_MODE_ID {
                    let _ = app_handle.emit("menu-toggle-source-mode", ());
                } else if id == TOGGLE_TYPEWRITER_MODE_ID {
                    let _ = app_handle.emit("menu-toggle-typewriter-mode", ());
                } else if id == TOGGLE_SIDEBAR_ID {
                    let _ = app_handle.emit("menu-toggle-sidebar", ());
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_file_dialog,
            save_file_dialog,
            list_dir,
            read_text_file,
            write_text_file,
            codex_login,
            codex_auth_status,
            codex_logout,
            claude_login,
            claude_auth_status,
            claude_logout,
            ai_complete,
            ai_grammar_check,
            ai_chat,
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
