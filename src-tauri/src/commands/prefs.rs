//! A tiny Rust-readable mirror of a couple of frontend settings whose
//! effect happens in Rust before any webview (let alone its localStorage)
//! exists: whether opening several documents at once (Finder "Open With"
//! multi-select, `levis a.md b.md`) should spawn one OS window per file or
//! batch them into tabs in a single window, and whether startup should
//! restore last session's documents. Settings otherwise live only in the
//! frontend's localStorage (see SettingsContext.tsx); these two get mirrored
//! here whenever the frontend changes them.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string()).map(|p| p.join("prefs.json"))
}

fn read_prefs(app: &AppHandle) -> serde_json::Value {
    let Ok(path) = prefs_path(app) else { return serde_json::json!({}) };
    let Ok(raw) = std::fs::read_to_string(path) else { return serde_json::json!({}) };
    serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}))
}

/// Merges `value` into the existing prefs.json under `key` instead of
/// overwriting the whole file, since more than one pref lives here now.
fn write_pref(app: &AppHandle, key: &str, value: serde_json::Value) -> Result<(), String> {
    let path = prefs_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut prefs = read_prefs(app);
    prefs[key] = value;
    std::fs::write(path, prefs.to_string()).map_err(|e| e.to_string())
}

/// Internal helper for lib.rs's window-spawning decisions. Defaults to
/// "window" (today's only behavior) on any missing/unreadable/malformed
/// file, same "safe default" precedent as commands::cli.
pub fn read_new_document_mode(app: &AppHandle) -> String {
    match read_prefs(app).get("new_document_mode").and_then(|v| v.as_str()) {
        Some("tab") => "tab".to_string(),
        _ => "window".to_string(),
    }
}

#[tauri::command]
pub fn get_new_document_mode(app: AppHandle) -> String {
    read_new_document_mode(&app)
}

#[tauri::command]
pub fn set_new_document_mode(app: AppHandle, mode: String) -> Result<(), String> {
    write_pref(&app, "new_document_mode", serde_json::json!(mode))
}

/// Internal helper for lib.rs's startup path-collection: whether to reopen
/// last session's documents (default) or start blank. Same "safe default"
/// precedent - missing/unreadable/malformed prefs.json means restore.
pub fn read_restore_session_on_startup(app: &AppHandle) -> bool {
    read_prefs(app).get("restore_session_on_startup").and_then(|v| v.as_bool()).unwrap_or(true)
}

#[tauri::command]
pub fn get_restore_session_on_startup(app: AppHandle) -> bool {
    read_restore_session_on_startup(&app)
}

#[tauri::command]
pub fn set_restore_session_on_startup(app: AppHandle, enabled: bool) -> Result<(), String> {
    write_pref(&app, "restore_session_on_startup", serde_json::json!(enabled))
}
