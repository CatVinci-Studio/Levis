use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize)]
struct ApiKeyRecord {
    key: String,
}

fn api_key_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("api_key.json"))
}

#[tauri::command]
pub fn set_api_key(app: AppHandle, key: String) -> Result<(), String> {
    let path = api_key_file_path(&app)?;
    let record = ApiKeyRecord { key };
    let json = serde_json::to_string(&record).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn api_key_status(app: AppHandle) -> Result<bool, String> {
    Ok(api_key_file_path(&app)?.exists())
}

#[tauri::command]
pub fn clear_api_key(app: AppHandle) -> Result<(), String> {
    let path = api_key_file_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn load_api_key(app: &AppHandle) -> Result<Option<String>, String> {
    let path = api_key_file_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let record: ApiKeyRecord = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(Some(record.key))
}
