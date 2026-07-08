use aicompat::providers::custom;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
pub struct CustomEndpointConfig {
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
}

fn config_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("custom_endpoint.json"))
}

#[tauri::command]
pub fn set_custom_endpoint(app: AppHandle, base_url: String, api_key: Option<String>, model: String) -> Result<(), String> {
    let path = config_file_path(&app)?;
    let config = CustomEndpointConfig { base_url, api_key, model };
    let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn load_custom_endpoint(app: &AppHandle) -> Result<Option<CustomEndpointConfig>, String> {
    let path = config_file_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn custom_endpoint_status(app: AppHandle) -> Result<Option<CustomEndpointConfig>, String> {
    load_custom_endpoint(&app)
}

#[tauri::command]
pub fn clear_custom_endpoint(app: AppHandle) -> Result<(), String> {
    let path = config_file_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn fetch_custom_models(base_url: String, api_key: Option<String>) -> Result<Vec<String>, String> {
    custom::list_models(&base_url, api_key.as_deref()).await
}

#[tauri::command]
pub async fn test_custom_endpoint(base_url: String, api_key: Option<String>) -> Result<(), String> {
    custom::list_models(&base_url, api_key.as_deref()).await.map(|_| ())
}
