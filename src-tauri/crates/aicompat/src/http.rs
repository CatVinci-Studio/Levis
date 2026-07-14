//! Shared HTTP client construction for every provider request.
//!
//! Some users (notably behind restrictive networks) can only reach the AI
//! providers through a proxy, and a GUI app launched from Finder doesn't
//! inherit shell env vars like HTTPS_PROXY - so the proxy is an explicit,
//! app-level setting mirrored here from the frontend. HTTPS itself needs no
//! setting: every request already goes over TLS (rustls).

use std::sync::RwLock;

static PROXY_URL: RwLock<Option<String>> = RwLock::new(None);

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

/// The client every provider request uses: plain by default, or routed
/// through the configured proxy. Falls back to a direct client if the stored
/// proxy somehow fails to build - a broken proxy setting shouldn't make the
/// app's AI features unreachable in both directions.
pub(crate) fn client() -> reqwest::Client {
    PROXY_URL
        .read()
        .unwrap()
        .clone()
        .and_then(|u| reqwest::Proxy::all(u).ok())
        .and_then(|p| reqwest::Client::builder().proxy(p).build().ok())
        .unwrap_or_default()
}
