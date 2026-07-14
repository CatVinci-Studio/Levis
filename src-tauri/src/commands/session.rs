use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Every window reports its own open (on-disk) tab paths whenever its tab
/// list changes; merged across windows and flattened to disk here so that
/// any relaunch - an app update, a crash, or just quitting and reopening -
/// can restore whatever documents were open. Unsaved/untitled tabs have no
/// path and can't be restored, so they're simply dropped.
pub struct SessionTabsState(pub Mutex<HashMap<String, Vec<String>>>);

fn session_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("session.json"))
}

pub fn read_session_paths(app: &AppHandle) -> Vec<String> {
    let Some(path) = session_file(app) else { return Vec::new() };
    fs::read_to_string(path).ok().and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default()
}

fn write_session_paths(app: &AppHandle, paths: &[String]) {
    let Some(path) = session_file(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(paths) {
        let _ = fs::write(path, json);
    }
}

/// Order-preserving flatten/dedup of every window's paths (window iteration
/// order isn't meaningful, but a stable per-path first-seen order is nicer
/// than an arbitrary one for the paths that do get restored).
fn merge_paths(map: &HashMap<String, Vec<String>>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut merged = Vec::new();
    for path in map.values().flatten() {
        if seen.insert(path.clone()) {
            merged.push(path.clone());
        }
    }
    merged
}

#[tauri::command]
pub fn update_session_paths(
    app: AppHandle,
    window: tauri::Window,
    paths: Vec<String>,
    state: tauri::State<SessionTabsState>,
) {
    let merged = {
        let mut map = state.0.lock().unwrap();
        map.insert(window.label().to_string(), paths);
        merge_paths(&map)
    };
    write_session_paths(&app, &merged);
}

/// Drops a closed window's contribution so its documents don't come back on
/// the next restore just because they happened to be open at some point.
pub fn forget_window(app: &AppHandle, label: &str, state: &SessionTabsState) {
    let merged = {
        let mut map = state.0.lock().unwrap();
        map.remove(label);
        merge_paths(&map)
    };
    write_session_paths(app, &merged);
}
