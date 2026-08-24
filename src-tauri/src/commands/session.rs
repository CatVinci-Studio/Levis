use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Every window reports its own open (on-disk) tab paths whenever its tab
/// list changes; merged across windows and flattened to disk here so that
/// any relaunch - an app update, a crash, or just quitting and reopening -
/// can restore whatever documents were open. Unsaved/untitled tabs have no
/// path and can't be restored, so they're simply dropped.
pub struct SessionTabsState(pub Mutex<HashMap<String, Vec<String>>>);

/// Set while File > Quit is closing every window. Those Destroyed events must
/// not progressively shrink the complete session snapshot captured at the
/// start of the quit operation.
static APP_QUITTING: AtomicBool = AtomicBool::new(false);

fn session_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("session.json"))
}

pub fn read_session_paths(app: &AppHandle) -> Vec<String> {
    let Some(path) = session_file(app) else {
        return Vec::new();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_session_paths(app: &AppHandle, paths: &[String]) {
    let Some(path) = session_file(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(paths) {
        let _ = crate::atomic::write_sync(&path, json);
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

/// Captures the complete session before File > Quit starts closing windows.
/// Each ensuing Destroyed event removes live bookkeeping but leaves this disk
/// snapshot untouched, regardless of destruction order.
pub fn begin_app_quit(app: &AppHandle, state: &SessionTabsState) {
    APP_QUITTING.store(true, Ordering::SeqCst);
    let paths = merge_paths(&state.0.lock().unwrap());
    write_session_paths(app, &paths);
}

pub fn app_quitting() -> bool {
    APP_QUITTING.load(Ordering::SeqCst)
}

/// A dirty-window prompt can cancel File > Quit after other windows have
/// already closed. Resume ordinary close bookkeeping and persist only the
/// windows that remain alive.
#[tauri::command]
pub fn cancel_session_quit(app: AppHandle, state: tauri::State<SessionTabsState>) {
    APP_QUITTING.store(false, Ordering::SeqCst);
    let paths = merge_paths(&state.0.lock().unwrap());
    write_session_paths(&app, &paths);
}

/// Removes a destroyed editor from the live map and returns the paths that
/// should replace the disk snapshot. `None` means preserve the snapshot: the
/// app is either quitting all windows, or this is the final application window
/// on a platform where destroying it exits the process.
fn remove_window_paths(
    map: &mut HashMap<String, Vec<String>>,
    label: &str,
    app_quitting: bool,
    preserve_last: bool,
) -> Option<Vec<String>> {
    map.remove(label)?;
    if app_quitting || (map.is_empty() && preserve_last) {
        None
    } else {
        Some(merge_paths(map))
    }
}

pub fn forget_window(app: &AppHandle, label: &str, state: &SessionTabsState, preserve_last: bool) {
    let merged = {
        let mut map = state.0.lock().unwrap();
        remove_window_paths(
            &mut map,
            label,
            APP_QUITTING.load(Ordering::SeqCst),
            preserve_last,
        )
    };
    if let Some(paths) = merged {
        write_session_paths(app, &paths);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(entries: &[(&str, &[&str])]) -> HashMap<String, Vec<String>> {
        entries
            .iter()
            .map(|(label, paths)| {
                (
                    (*label).to_string(),
                    paths.iter().map(|path| (*path).to_string()).collect(),
                )
            })
            .collect()
    }

    #[test]
    fn windows_exit_preserves_the_last_window_snapshot() {
        let mut map = paths(&[("main", &["one.md"])]);

        assert_eq!(remove_window_paths(&mut map, "main", false, true), None);
        assert!(map.is_empty());
    }

    #[test]
    fn macos_windowless_state_persists_an_empty_session() {
        let mut map = paths(&[("main", &["one.md"])]);

        assert_eq!(
            remove_window_paths(&mut map, "main", false, false),
            Some(Vec::new())
        );
    }

    #[test]
    fn closing_one_of_multiple_windows_persists_the_remainder() {
        let mut map = paths(&[("main", &["one.md"]), ("window-1", &["two.md"])]);

        assert_eq!(
            remove_window_paths(&mut map, "main", false, false),
            Some(vec!["two.md".to_string()])
        );
    }

    #[test]
    fn app_quit_never_shrinks_the_captured_snapshot() {
        let mut map = paths(&[("main", &["one.md"]), ("window-1", &["two.md"])]);

        assert_eq!(remove_window_paths(&mut map, "main", true, false), None);
        assert_eq!(remove_window_paths(&mut map, "window-1", true, false), None);
    }

    #[test]
    fn unrelated_window_does_not_rewrite_the_session() {
        let mut map = paths(&[("main", &["one.md"])]);

        assert_eq!(
            remove_window_paths(&mut map, "chat-main", false, false),
            None
        );
        assert_eq!(map.len(), 1);
    }
}
