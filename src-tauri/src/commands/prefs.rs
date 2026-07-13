//! A tiny Rust-readable mirror of one frontend setting: whether opening
//! several documents at once (Finder "Open With" multi-select, `levis a.md
//! b.md`) should spawn one OS window per file or batch them into tabs in a
//! single window. Settings otherwise live only in the frontend's
//! localStorage (see SettingsContext.tsx), which Rust can't read - and the
//! window-vs-tab decision has to be made in Rust, before any webview
//! (let alone its localStorage) exists, so this one flag gets mirrored here
//! whenever the frontend changes it.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string()).map(|p| p.join("prefs.json"))
}

/// Internal helper for lib.rs's window-spawning decisions. Defaults to
/// "window" (today's only behavior) on any missing/unreadable/malformed
/// file, same "safe default" precedent as commands::cli.
pub fn read_new_document_mode(app: &AppHandle) -> String {
    let Ok(path) = prefs_path(app) else { return "window".to_string() };
    let Ok(raw) = std::fs::read_to_string(path) else { return "window".to_string() };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else { return "window".to_string() };
    match value.get("new_document_mode").and_then(|v| v.as_str()) {
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
    let path = prefs_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let body = serde_json::json!({ "new_document_mode": mode }).to_string();
    std::fs::write(path, body).map_err(|e| e.to_string())
}
