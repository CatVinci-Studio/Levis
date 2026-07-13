use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Recently opened files, backing File > Open Recent. Persisted as a plain
/// JSON array (most recent first) next to prefs.json, so the menu survives
/// restarts. The frontend reports every successful open/save-as via
/// add_recent_file; the Rust side owns the list and the menu that mirrors
/// it (lib.rs's rebuild_recent_menu).
const MAX_RECENT_FILES: usize = 10;

fn recents_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("recent_files.json"))
}

pub fn read_recent_files(app: &tauri::AppHandle) -> Vec<String> {
    let Some(path) = recents_file(app) else { return Vec::new() };
    fs::read_to_string(path).ok().and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default()
}

fn write_recent_files(app: &tauri::AppHandle, list: &[String]) {
    let Some(path) = recents_file(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(list) {
        let _ = fs::write(path, json);
    }
}

#[tauri::command]
pub fn add_recent_file(app: tauri::AppHandle, path: String) {
    let mut list = read_recent_files(&app);
    list.retain(|p| p != &path);
    list.insert(0, path);
    list.truncate(MAX_RECENT_FILES);
    write_recent_files(&app, &list);
    crate::rebuild_recent_menu(&app, list);
}

pub fn clear_recent_files(app: &tauri::AppHandle) {
    write_recent_files(app, &[]);
    crate::rebuild_recent_menu(app, Vec::new());
}
