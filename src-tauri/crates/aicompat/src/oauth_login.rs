use std::collections::HashMap;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::oauth_server::wait_for_callback;

/// Told a URL (see `PkceLoginRequest::on_authorize_url`).
pub type UrlListener = Box<dyn Fn(&str) + Send + Sync>;

pub struct PkceLoginRequest {
    pub authorize_url: String,
    pub callback_port: u16,
    pub response_html: String,
    pub expected_state: String,
    pub timeout_secs: u64,
    /// Told the sign-in page's URL before the browser is asked to open it,
    /// so the UI can offer it by hand: on some machines no browser comes up
    /// (no default browser set, a sandbox, a remote session), and without
    /// the link there was no way to sign in at all.
    pub on_authorize_url: Option<UrlListener>,
}

/// Runs the browser-based half of a PKCE OAuth login shared by every
/// provider: open the system browser at `authorize_url`, wait for the
/// localhost redirect, verify `state`, and hand back the authorization
/// code. Each provider does its own token exchange with the code afterwards
/// (the request bodies/response shapes differ per provider).
pub async fn run_pkce_login(app: &AppHandle, req: PkceLoginRequest) -> Result<String, String> {
    let callback_task = wait_for_callback(req.callback_port, req.response_html, req.timeout_secs);

    if let Some(announce) = &req.on_authorize_url {
        announce(&req.authorize_url);
    }
    // Not fatal when the browser won't open: the page has the link to open
    // by hand, and the callback below still completes the sign-in.
    if let Err(e) = app.opener().open_url(&req.authorize_url, None::<String>) {
        eprintln!("could not open the browser for sign-in: {e}");
    }

    // `wait_for_callback` already hands back a full absolute URL (the
    // plugin round-trips the browser's real `window.location.href` through
    // a `Full-Url` header), so this must be parsed as-is - prepending
    // another `http://localhost:{port}` here previously produced a
    // malformed double URL and an "invalid port number" parse error.
    let callback_url = callback_task.await?;

    let full_url = url::Url::parse(&callback_url).map_err(|e| e.to_string())?;
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
