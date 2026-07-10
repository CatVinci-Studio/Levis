use std::sync::mpsc;
use std::time::Duration;

/// Starts a localhost callback server on `port`, waits (up to `timeout_secs`)
/// for the OAuth redirect to hit it, and returns the full callback URL the
/// provider redirected to (e.g. `http://localhost:1455/auth/callback?code=...&state=...`).
///
/// Shared by every OAuth provider - none of this is provider-specific.
pub async fn wait_for_callback(port: u16, response_html: String, timeout_secs: u64) -> Result<String, String> {
    let (tx, rx) = mpsc::channel::<String>();

    tauri_plugin_oauth::start_with_config(
        tauri_plugin_oauth::OauthConfig {
            ports: Some(vec![port]),
            response: Some(response_html.into()),
            ..Default::default()
        },
        move |url| {
            let _ = tx.send(url);
        },
    )
    .map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(timeout_secs)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "login timed out or was cancelled".to_string())
}
