use crate::pkce::{generate_pkce, now_ms};
use serde::{Deserialize, Serialize};

// Values confirmed against earendil-works/pi's anthropic.ts oauth client.
const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL: &str = "https://claude.ai/oauth/authorize";
const TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
pub const CALLBACK_PORT: u16 = 53692;
pub const REDIRECT_URI: &str = "http://localhost:53692/callback";
const SCOPES: &str =
    "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

const MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const COMPLETION_MODEL: &str = "claude-haiku-4-5-20251001";
const CLAUDE_CODE_IDENTITY: &str = "You are Claude Code, Anthropic's official CLI for Claude.";

#[derive(Serialize, Deserialize, Clone)]
pub struct ClaudeCredential {
    pub access: String,
    pub refresh: String,
    /// ms since epoch
    pub expires: i64,
}

/// Builds the browser authorize URL plus the PKCE verifier, which pi's
/// reference implementation reuses as the OAuth `state` value too (unusual,
/// but matches the reference exactly so this login flow actually works).
pub fn build_authorize_request() -> Result<(String, String, String), String> {
    let (verifier, challenge) = generate_pkce();
    let state = verifier.clone();

    let mut authorize_url = url::Url::parse(AUTHORIZE_URL).map_err(|e| e.to_string())?;
    authorize_url
        .query_pairs_mut()
        .append_pair("code", "true")
        .append_pair("client_id", CLIENT_ID)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("scope", SCOPES)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state);

    Ok((authorize_url.to_string(), verifier, state))
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
}

fn credential_from_token(token: TokenResponse) -> ClaudeCredential {
    ClaudeCredential {
        access: token.access_token,
        refresh: token.refresh_token,
        // Reference implementation shaves 5 minutes off to refresh a little early.
        expires: now_ms() + token.expires_in * 1000 - 5 * 60 * 1000,
    }
}

pub async fn exchange_code(code: &str, state: &str, verifier: &str) -> Result<ClaudeCredential, String> {
    let client = crate::http::client();
    let res = client
        .post(TOKEN_URL)
        .json(&serde_json::json!({
            "grant_type": "authorization_code",
            "client_id": CLIENT_ID,
            "code": code,
            "state": state,
            "redirect_uri": REDIRECT_URI,
            "code_verifier": verifier,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("token exchange failed ({status}): {body}"));
    }

    Ok(credential_from_token(res.json().await.map_err(|e| e.to_string())?))
}

pub async fn refresh(refresh_token: &str) -> Result<ClaudeCredential, String> {
    let client = crate::http::client();
    let res = client
        .post(TOKEN_URL)
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "client_id": CLIENT_ID,
            "refresh_token": refresh_token,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("token refresh failed ({status}): {body}"));
    }

    Ok(credential_from_token(res.json().await.map_err(|e| e.to_string())?))
}

#[derive(Serialize)]
struct SystemBlock {
    #[serde(rename = "type")]
    kind: &'static str,
    text: String,
}

#[derive(Serialize)]
struct Message {
    role: &'static str,
    content: String,
}

#[derive(Serialize)]
struct MessagesRequest {
    model: &'static str,
    max_tokens: u32,
    system: Vec<SystemBlock>,
    messages: Vec<Message>,
}

#[derive(Deserialize, Default)]
struct ContentBlock {
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize, Default)]
struct MessagesResponse {
    #[serde(default)]
    content: Vec<ContentBlock>,
}

/// Calls the standard public Anthropic Messages API. OAuth (Claude Code)
/// tokens are accepted there directly via Bearer auth, provided the request
/// carries the Claude Code identity headers/system prompt the token is
/// scoped to - without these the API rejects the OAuth token outright.
pub async fn call_completion(access_token: &str, instructions: String, user_text: String) -> Result<String, String> {
    let body = MessagesRequest {
        model: COMPLETION_MODEL,
        max_tokens: 1024,
        system: vec![
            SystemBlock {
                kind: "text",
                text: CLAUDE_CODE_IDENTITY.to_string(),
            },
            SystemBlock {
                kind: "text",
                text: instructions,
            },
        ],
        messages: vec![Message {
            role: "user",
            content: user_text,
        }],
    };

    let client = crate::http::client();
    let res = client
        .post(MESSAGES_URL)
        .bearer_auth(access_token)
        .header("anthropic-beta", "claude-code-20250219,oauth-2025-04-20")
        .header("anthropic-dangerous-direct-browser-access", "true")
        .header("user-agent", "claude-cli/1.0.0")
        .header("x-app", "cli")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Claude request failed ({status}): {text}"));
    }

    let parsed: MessagesResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(parsed.content.into_iter().find_map(|c| c.text).unwrap_or_default())
}
