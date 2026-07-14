use crate::agent::{AgentTurn, StepResult, ToolSpec};
use crate::pkce::{decode_base64url, generate_pkce, generate_state, now_ms};
use crate::responses_api::{read_streamed_output, text_from_streamed_output, ResponsesRequest};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL: &str = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
pub const CALLBACK_PORT: u16 = 1455;
pub const REDIRECT_URI: &str = "http://localhost:1455/auth/callback";
const SCOPE: &str = "openid profile email offline_access";
const JWT_CLAIM_PATH: &str = "https://api.openai.com/auth";

// The Codex OAuth token only works against ChatGPT's backend API (used by
// the chatgpt.com web app and the Codex CLI), not the public
// api.openai.com Responses API. Confirmed against the equivalent open-source
// client implementation (earendil-works/pi).
const CODEX_RESPONSES_URL: &str = "https://chatgpt.com/backend-api/codex/responses";
const COMPLETION_MODEL: &str = "gpt-5.4-mini";

#[derive(Serialize, Deserialize, Clone)]
pub struct CodexCredential {
    pub access: String,
    pub refresh: String,
    /// ms since epoch
    pub expires: i64,
    pub account_id: String,
}

/// Builds the browser authorize URL plus the PKCE verifier and state that
/// must be kept around for the token exchange / callback verification.
/// `originator` identifies the calling app to OpenAI (any short slug works -
/// this mirrors what the Codex CLI itself sends, just naming a different
/// client).
pub fn build_authorize_request(originator: &str) -> Result<(String, String, String), String> {
    let (verifier, challenge) = generate_pkce();
    let state = generate_state();

    let mut authorize_url = url::Url::parse(AUTHORIZE_URL).map_err(|e| e.to_string())?;
    authorize_url
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("id_token_add_organizations", "true")
        .append_pair("codex_cli_simplified_flow", "true")
        .append_pair("originator", originator);

    Ok((authorize_url.to_string(), verifier, state))
}

fn decode_account_id(access_token: &str) -> Option<String> {
    let payload_b64 = access_token.split('.').nth(1)?;
    let payload_bytes = decode_base64url(payload_b64)?;
    let payload: serde_json::Value = serde_json::from_slice(&payload_bytes).ok()?;
    payload
        .get(JWT_CLAIM_PATH)?
        .get("chatgpt_account_id")?
        .as_str()
        .map(|s| s.to_string())
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
}

fn credential_from_token(token: TokenResponse) -> Result<CodexCredential, String> {
    let account_id = decode_account_id(&token.access_token)
        .ok_or_else(|| "failed to extract account id from token".to_string())?;
    Ok(CodexCredential {
        access: token.access_token,
        refresh: token.refresh_token,
        expires: now_ms() + token.expires_in * 1000,
        account_id,
    })
}

pub async fn exchange_code(code: &str, verifier: &str) -> Result<CodexCredential, String> {
    let client = crate::http::client();
    let res = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", CLIENT_ID),
            ("code", code),
            ("code_verifier", verifier),
            ("redirect_uri", REDIRECT_URI),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("token exchange failed ({status}): {body}"));
    }

    credential_from_token(res.json().await.map_err(|e| e.to_string())?)
}

pub async fn refresh(refresh_token: &str) -> Result<CodexCredential, String> {
    let client = crate::http::client();
    let res = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", CLIENT_ID),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("token refresh failed ({status}): {body}"));
    }

    credential_from_token(res.json().await.map_err(|e| e.to_string())?)
}

pub async fn call_completion(
    access_token: &str,
    account_id: &str,
    originator: &str,
    instructions: String,
    user_text: String,
) -> Result<String, String> {
    let body = ResponsesRequest::new(COMPLETION_MODEL, instructions, user_text).streaming();

    let client = crate::http::client();
    let res = client
        .post(CODEX_RESPONSES_URL)
        .bearer_auth(access_token)
        .header("chatgpt-account-id", account_id)
        .header("originator", originator)
        .header("OpenAI-Beta", "responses=experimental")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let output = read_streamed_output(res, "Codex").await?;
    Ok(text_from_streamed_output(&output))
}

fn turn_to_input_item(turn: &AgentTurn) -> Value {
    match turn {
        AgentTurn::User { text } => json!({
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": text}],
        }),
        AgentTurn::Assistant { text } => json!({
            "type": "message",
            "role": "assistant",
            "content": [{"type": "output_text", "text": text}],
        }),
        AgentTurn::ToolCall { call_id, name, arguments } => json!({
            "type": "function_call",
            "call_id": call_id,
            "name": name,
            "arguments": arguments,
        }),
        AgentTurn::ToolResult { call_id, output } => json!({
            "type": "function_call_output",
            "call_id": call_id,
            "output": output,
        }),
    }
}

fn tool_to_schema(tool: &ToolSpec) -> Value {
    json!({
        "type": "function",
        "name": tool.name,
        "description": tool.description,
        "parameters": tool.parameters,
    })
}

/// Runs one round-trip against Codex with the full turn history and tool
/// definitions. Returns either the model's final text, or one-or-more tool
/// calls the caller must execute and feed back via `AgentTurn::ToolResult`
/// before calling this again.
pub async fn agent_step(
    access_token: &str,
    account_id: &str,
    originator: &str,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: bool,
) -> Result<StepResult, String> {
    let input: Vec<Value> = history.iter().map(turn_to_input_item).collect();
    let mut tool_schemas: Vec<Value> = tools.iter().map(tool_to_schema).collect();
    // OpenAI's server-side web search: unlike function tools it runs inside
    // the response (search calls surface as ignored `web_search_call` output
    // items), so no loop changes are needed - just offering it is enough.
    if web_search {
        tool_schemas.push(json!({"type": "web_search"}));
    }

    let body = json!({
        "model": COMPLETION_MODEL,
        "store": false,
        "stream": true,
        "instructions": instructions,
        "input": input,
        "tools": tool_schemas,
        "tool_choice": "auto",
        "parallel_tool_calls": true,
        "text": {"verbosity": "low"},
    });

    let client = crate::http::client();
    let res = client
        .post(CODEX_RESPONSES_URL)
        .bearer_auth(access_token)
        .header("chatgpt-account-id", account_id)
        .header("originator", originator)
        .header("OpenAI-Beta", "responses=experimental")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let output = read_streamed_output(res, "Codex").await?;

    let mut tool_calls = Vec::new();
    let mut text_parts = Vec::new();

    for item in &output {
        match item.get("type").and_then(|t| t.as_str()) {
            Some("function_call") => {
                let call_id = item.get("call_id").and_then(|v| v.as_str()).unwrap_or_default();
                let name = item.get("name").and_then(|v| v.as_str()).unwrap_or_default();
                let arguments = item.get("arguments").and_then(|v| v.as_str()).unwrap_or("{}");
                tool_calls.push(AgentTurn::ToolCall {
                    call_id: call_id.to_string(),
                    name: name.to_string(),
                    arguments: arguments.to_string(),
                });
            }
            Some("message") => {
                if let Some(content) = item.get("content").and_then(|c| c.as_array()) {
                    for part in content {
                        if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                            text_parts.push(text.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }

    if !tool_calls.is_empty() {
        return Ok(StepResult::ToolCalls(tool_calls));
    }

    Ok(StepResult::Done(text_parts.join("\n")))
}
