//! Per-provider API keys, stored together in one 0600 JSON file
//! (`provider_keys.json`, provider id -> key). Replaces the old single-key
//! `api_key.json`, which held only the OpenAI key - that file is migrated in
//! on first read and removed.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn keys_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("provider_keys.json"))
}

fn legacy_openai_key_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("api_key.json"))
}

fn read_keys(app: &AppHandle) -> Result<HashMap<String, String>, String> {
    let path = keys_file_path(app)?;
    let mut keys: HashMap<String, String> = if path.exists() {
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).map_err(|e| e.to_string())?
    } else {
        HashMap::new()
    };

    let legacy = legacy_openai_key_path(app)?;
    if legacy.exists() {
        #[derive(serde::Deserialize)]
        struct LegacyRecord {
            key: String,
        }
        if let Ok(record) =
            serde_json::from_str::<LegacyRecord>(&fs::read_to_string(&legacy).unwrap_or_default())
        {
            keys.entry("openai".to_string()).or_insert(record.key);
            write_keys(app, &keys)?;
        }
        let _ = fs::remove_file(&legacy);
    }

    Ok(keys)
}

fn write_keys(app: &AppHandle, keys: &HashMap<String, String>) -> Result<(), String> {
    let path = keys_file_path(app)?;
    let json = serde_json::to_string(keys).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn load_provider_key(app: &AppHandle, provider: &str) -> Result<Option<String>, String> {
    Ok(read_keys(app)?.get(provider).cloned())
}

#[tauri::command]
pub fn set_provider_api_key(app: AppHandle, provider: String, key: String) -> Result<(), String> {
    let mut keys = read_keys(&app)?;
    keys.insert(provider, key);
    write_keys(&app, &keys)
}

#[tauri::command]
pub fn provider_api_key_status(app: AppHandle, provider: String) -> Result<bool, String> {
    Ok(read_keys(&app)?.contains_key(&provider))
}

#[tauri::command]
pub fn clear_provider_api_key(app: AppHandle, provider: String) -> Result<(), String> {
    let mut keys = read_keys(&app)?;
    if keys.remove(&provider).is_some() {
        write_keys(&app, &keys)?;
    }
    Ok(())
}
