use std::collections::HashMap;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::oauth_server::wait_for_callback;

pub struct PkceLoginRequest {
    pub authorize_url: String,
    pub callback_port: u16,
    pub response_html: String,
    pub expected_state: String,
    pub timeout_secs: u64,
}

/// Runs the browser-based half of a PKCE OAuth login shared by every
/// provider: open the system browser at `authorize_url`, wait for the
/// localhost redirect, verify `state`, and hand back the authorization
/// code. Each provider does its own token exchange with the code afterwards
/// (the request bodies/response shapes differ per provider).
pub async fn run_pkce_login(app: &AppHandle, req: PkceLoginRequest) -> Result<String, String> {
    let callback_task = wait_for_callback(req.callback_port, req.response_html, req.timeout_secs);

    app.opener()
        .open_url(req.authorize_url, None::<String>)
        .map_err(|e| e.to_string())?;

    let callback_path_and_query = callback_task.await?;

    let full_url = url::Url::parse(&format!(
        "http://localhost:{}{}",
        req.callback_port, callback_path_and_query
    ))
    .map_err(|e| e.to_string())?;
    let params: HashMap<_, _> = full_url.query_pairs().collect();

    let returned_state = params.get("state").map(|s| s.as_ref());
    if returned_state != Some(req.expected_state.as_str()) {
        return Err("OAuth state mismatch".to_string());
    }

    params
        .get("code")
        .map(|c| c.to_string())
        .ok_or_else(|| "missing authorization code".to_string())
}
