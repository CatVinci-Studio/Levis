//! Turns a catalog entry into actual credentials for a request. Isolates the
//! "which auth method is actually configured" decision so `client.rs` and
//! `agent.rs` only deal in dialects, not per-provider auth special-casing.

use crate::ai::catalog::ProviderCatalogEntry;
use aicompat::providers::anthropic::AnthropicAuth;
use tauri::AppHandle;

pub(crate) const NOT_CONFIGURED: &str =
    "This provider isn't set up yet - configure it in Settings.";

pub enum OpenaiAuth {
    /// Browser "sign in with ChatGPT" - talks to the ChatGPT backend, not
    /// the public API (see `openai_codex`).
    Codex {
        access_token: String,
        account_id: String,
    },
    ApiKey(String),
}

/// OAuth (ChatGPT sign-in) is preferred when both are configured - it's the
/// richer entitlement (Plus/Pro), and it's what a user who did both probably
/// wants active.
pub async fn resolve_openai_auth(app: &AppHandle) -> Result<OpenaiAuth, String> {
    if let Ok((access_token, account_id)) =
        crate::auth::openai_codex::get_valid_credential(app).await
    {
        return Ok(OpenaiAuth::Codex {
            access_token,
            account_id,
        });
    }
    let key = crate::auth::keys::load_provider_key(app, "openai")?
        .ok_or_else(|| NOT_CONFIGURED.to_string())?;
    Ok(OpenaiAuth::ApiKey(key))
}

/// Same preference order as `resolve_openai_auth`: OAuth (Claude Pro/Max
/// sign-in) first, falling back to a pasted API key.
pub async fn resolve_anthropic_auth(app: &AppHandle) -> Result<AnthropicAuth, String> {
    if let Ok(access_token) = crate::auth::claude::get_valid_credential(app).await {
        return Ok(AnthropicAuth::Oauth(access_token));
    }
    let key = crate::auth::keys::load_provider_key(app, "anthropic")?
        .ok_or_else(|| NOT_CONFIGURED.to_string())?;
    Ok(AnthropicAuth::ApiKey(key))
}

/// Resolves an `openai-chat-completions` provider to (base_url, api_key,
/// default_model). "custom" is the one id in this dialect with no fixed
/// catalog endpoint - its base_url/key/model are entirely user-supplied.
pub async fn resolve_chat_completions(
    app: &AppHandle,
    entry: &ProviderCatalogEntry,
) -> Result<(String, Option<String>, Option<String>), String> {
    if entry.id == "custom" {
        let config = crate::auth::custom_endpoint::load_custom_endpoint(app)?
            .ok_or_else(|| NOT_CONFIGURED.to_string())?;
        return Ok((config.base_url, config.api_key, Some(config.model)));
    }

    let base_url = entry
        .base_url
        .expect("non-custom chat-completions catalog entries carry a base_url")
        .to_string();
    let key = crate::auth::keys::load_provider_key(app, entry.id)?;
    if key.is_none() && !entry.key_optional {
        return Err(NOT_CONFIGURED.to_string());
    }
    Ok((base_url, key, entry.default_model.map(str::to_string)))
}
