//! Shared HTTP client construction for every provider request.
//!
//! Some users (notably behind restrictive networks) can only reach the AI
//! providers through a proxy, and a GUI app launched from Finder doesn't
//! inherit shell env vars like HTTPS_PROXY - so the proxy is an explicit,
//! app-level setting mirrored here from the frontend. HTTPS itself needs no
//! setting: every request already goes over TLS (rustls).

use std::sync::RwLock;
use std::time::Duration;

static PROXY_URL: RwLock<Option<String>> = RwLock::new(None);

/// Total request timeout (connect + send + receive the full response).
/// Previously unset entirely, so a provider that stopped responding mid-way
/// because of a dead proxy or a hung custom endpoint could hold the request
/// forever, leaving the frontend no recovery short of restarting the app.
///
/// 120s comfortably covers a slow model's full response (every provider here
/// returns one complete body, never an incrementally-streamed one; see
/// `responses_api.rs`'s `read_streamed_output`) while still giving up.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Sets (or clears, with None/empty) the proxy all provider requests route
/// through. Accepts whatever `reqwest::Proxy::all` does - http://, https://,
/// and socks5:// / socks5h:// URLs - and rejects unparseable ones so a typo
/// fails here, visibly, instead of silently at request time.
pub fn set_proxy(url: Option<String>) -> Result<(), String> {
    let url = url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty());
    if let Some(u) = &url {
        reqwest::Proxy::all(u.clone()).map_err(|e| format!("invalid proxy URL: {e}"))?;
    }
    *PROXY_URL.write().unwrap() = url;
    Ok(())
}

fn builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
}

/// The client every provider request uses: plain by default, or routed
/// through the configured proxy. Falls back to a direct (still timed-out)
/// client if the stored proxy somehow fails to build - a broken proxy
/// setting shouldn't make the app's AI features unreachable in both
/// directions.
pub(crate) fn client() -> reqwest::Client {
    PROXY_URL
        .read()
        .unwrap()
        .clone()
        .and_then(|u| reqwest::Proxy::all(u).ok())
        .and_then(|p| builder().proxy(p).build().ok())
        .or_else(|| builder().build().ok())
        .unwrap_or_default()
}
