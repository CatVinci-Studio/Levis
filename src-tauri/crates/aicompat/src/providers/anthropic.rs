use crate::agent::{AgentTurn, StepResult, ToolSpec};
use crate::pkce::{generate_pkce, now_ms};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

// Values confirmed against earendil-works/pi's anthropic.ts oauth client.
const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL: &str = "https://claude.ai/oauth/authorize";
const TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
pub const CALLBACK_PORT: u16 = 53692;
pub const REDIRECT_URI: &str = "http://localhost:53692/callback";
const SCOPES: &str =
    "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

const MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
/// Also the agent loop's default model when the user hasn't picked one.
pub const COMPLETION_MODEL: &str = "claude-haiku-4-5-20251001";
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
    model: String,
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
/// `model` overrides COMPLETION_MODEL when set.
pub async fn call_completion(
    access_token: &str,
    instructions: String,
    user_text: String,
    model: Option<&str>,
) -> Result<String, String> {
    let body = MessagesRequest {
        model: model.unwrap_or(COMPLETION_MODEL).to_string(),
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

#[derive(Deserialize)]
struct ModelListEntry {
    id: String,
}

#[derive(Deserialize, Default)]
struct ModelListResponse {
    #[serde(default)]
    data: Vec<ModelListEntry>,
}

/// Lists available models for the agent model picker in Settings.
pub async fn list_models(access_token: &str) -> Result<Vec<String>, String> {
    let client = crate::http::client();
    let res = client
        .get("https://api.anthropic.com/v1/models")
        .bearer_auth(access_token)
        .header("anthropic-version", "2023-06-01")
        .header("anthropic-beta", "claude-code-20250219,oauth-2025-04-20")
        .header("anthropic-dangerous-direct-browser-access", "true")
        .header("user-agent", "claude-cli/1.0.0")
        .header("x-app", "cli")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Could not list models ({status}): {text}"));
    }

    let parsed: ModelListResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(parsed.data.into_iter().map(|m| m.id).collect())
}

// --- Agentic tool-calling support (the anthropic-messages dialect - see
// `aicompat::agent` for the provider-agnostic loop this feeds).

fn tool_to_schema(tool: &ToolSpec) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description,
        "input_schema": tool.parameters,
    })
}

/// Groups the flat `AgentTurn` history into Messages API turns. This is
/// where the Anthropic dialect genuinely differs from the Responses API one
/// (`responses_api::agent_request_body`, which just emits one item per
/// turn): Messages requires strictly alternating user/assistant roles, so a
/// `ToolCall`/`ToolResult` can't each be their own message the way they are
/// for OpenAI - every `ToolCall` in a run must land in ONE assistant
/// message's `tool_use` blocks, immediately followed by every `ToolResult`
/// in that run as ONE user message's `tool_result` blocks (matched by id).
/// `run_agent_loop` interleaves them as Call1, Result1, Call2, Result2, ...
/// (see agent.rs), so a run is collected in that order and re-emitted as
/// [assistant: tool_use*] then [user: tool_result*].
///
/// One fidelity trade-off: if the model calls tools across more than one
/// step without a plain turn in between (rare - e.g. it calls a tool, gets
/// the result, and immediately calls another before writing any text), this
/// merges both steps' calls into a single assistant turn instead of two.
/// That's structurally valid (ids still line up 1:1 with their results) and
/// only costs the model a little turn-shape fidelity, never a 400.
fn turns_to_messages(history: &[AgentTurn]) -> Vec<Value> {
    let mut messages = Vec::new();
    let mut i = 0;
    while i < history.len() {
        match &history[i] {
            AgentTurn::User { text } => {
                messages.push(json!({"role": "user", "content": text}));
                i += 1;
            }
            AgentTurn::Assistant { text } => {
                messages.push(json!({"role": "assistant", "content": text}));
                i += 1;
            }
            AgentTurn::ToolCall { .. } | AgentTurn::ToolResult { .. } => {
                let mut tool_uses = Vec::new();
                let mut tool_results = Vec::new();
                while let Some(turn) = history.get(i) {
                    match turn {
                        AgentTurn::ToolCall { call_id, name, arguments } => {
                            let input: Value = serde_json::from_str(arguments).unwrap_or_else(|_| json!({}));
                            tool_uses.push(json!({
                                "type": "tool_use",
                                "id": call_id,
                                "name": name,
                                "input": input,
                            }));
                            i += 1;
                        }
                        AgentTurn::ToolResult { call_id, output } => {
                            tool_results.push(json!({
                                "type": "tool_result",
                                "tool_use_id": call_id,
                                "content": output,
                            }));
                            i += 1;
                        }
                        _ => break,
                    }
                }
                if !tool_uses.is_empty() {
                    messages.push(json!({"role": "assistant", "content": tool_uses}));
                }
                if !tool_results.is_empty() {
                    messages.push(json!({"role": "user", "content": tool_results}));
                }
            }
        }
    }
    messages
}

/// Parses a Messages API `content` block array into a [`StepResult`]: any
/// `tool_use` blocks become tool calls the caller must execute, otherwise
/// the `text` blocks are the model's final answer.
fn parse_agent_response(content: &[Value]) -> StepResult {
    let mut tool_calls = Vec::new();
    let mut text_parts = Vec::new();

    for block in content {
        match block.get("type").and_then(|t| t.as_str()) {
            Some("tool_use") => {
                let call_id = block.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                let name = block.get("name").and_then(|v| v.as_str()).unwrap_or_default();
                let arguments = block.get("input").cloned().unwrap_or_else(|| json!({})).to_string();
                tool_calls.push(AgentTurn::ToolCall {
                    call_id: call_id.to_string(),
                    name: name.to_string(),
                    arguments,
                });
            }
            Some("text") => {
                if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                    text_parts.push(text.to_string());
                }
            }
            _ => {}
        }
    }

    if !tool_calls.is_empty() {
        StepResult::ToolCalls(tool_calls)
    } else {
        StepResult::Done(text_parts.join("\n"))
    }
}

/// Runs one round-trip against Claude with the full turn history and tool
/// definitions - the Anthropic twin of `openai_codex::agent_step`. Same
/// OAuth-token identity headers as `call_completion` (required for the
/// token to be accepted at all - see that function's doc comment).
pub async fn agent_step(
    access_token: &str,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    model: &str,
) -> Result<StepResult, String> {
    let body = json!({
        "model": model,
        "max_tokens": 4096,
        "system": [
            {"type": "text", "text": CLAUDE_CODE_IDENTITY},
            {"type": "text", "text": instructions},
        ],
        "messages": turns_to_messages(history),
        "tools": tools.iter().map(tool_to_schema).collect::<Vec<_>>(),
    });

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

    let parsed: Value = res.json().await.map_err(|e| e.to_string())?;
    let content = parsed.get("content").and_then(|c| c.as_array()).cloned().unwrap_or_default();
    Ok(parse_agent_response(&content))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turns_to_messages_maps_plain_turns_1_to_1() {
        let history = vec![
            AgentTurn::User { text: "hi".to_string() },
            AgentTurn::Assistant { text: "hello".to_string() },
        ];
        let messages = turns_to_messages(&history);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[0]["content"], "hi");
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[1]["content"], "hello");
    }

    #[test]
    fn turns_to_messages_groups_interleaved_tool_calls_into_one_pair() {
        // run_agent_loop interleaves Call1, Result1, Call2, Result2 - this
        // must become exactly one assistant message (both tool_use blocks)
        // followed by one user message (both tool_result blocks), or Claude
        // rejects the request for having consecutive assistant messages.
        let history = vec![
            AgentTurn::User { text: "do it".to_string() },
            AgentTurn::ToolCall {
                call_id: "1".to_string(),
                name: "search_document".to_string(),
                arguments: "{\"query\":\"a\"}".to_string(),
            },
            AgentTurn::ToolResult {
                call_id: "1".to_string(),
                output: "found a".to_string(),
            },
            AgentTurn::ToolCall {
                call_id: "2".to_string(),
                name: "search_document".to_string(),
                arguments: "{\"query\":\"b\"}".to_string(),
            },
            AgentTurn::ToolResult {
                call_id: "2".to_string(),
                output: "found b".to_string(),
            },
            AgentTurn::Assistant { text: "done".to_string() },
        ];

        let messages = turns_to_messages(&history);
        assert_eq!(messages.len(), 4); // user, assistant(tool_use x2), user(tool_result x2), assistant

        assert_eq!(messages[1]["role"], "assistant");
        let tool_uses = messages[1]["content"].as_array().unwrap();
        assert_eq!(tool_uses.len(), 2);
        assert_eq!(tool_uses[0]["type"], "tool_use");
        assert_eq!(tool_uses[0]["id"], "1");
        assert_eq!(tool_uses[0]["input"]["query"], "a");
        assert_eq!(tool_uses[1]["id"], "2");

        assert_eq!(messages[2]["role"], "user");
        let tool_results = messages[2]["content"].as_array().unwrap();
        assert_eq!(tool_results.len(), 2);
        assert_eq!(tool_results[0]["type"], "tool_result");
        assert_eq!(tool_results[0]["tool_use_id"], "1");
        assert_eq!(tool_results[0]["content"], "found a");
        assert_eq!(tool_results[1]["tool_use_id"], "2");

        assert_eq!(messages[3]["role"], "assistant");
        assert_eq!(messages[3]["content"], "done");
    }

    #[test]
    fn parse_agent_response_prefers_tool_use_over_text() {
        let content = vec![
            json!({"type": "tool_use", "id": "c1", "name": "propose_edit", "input": {"action": "append", "text": "hi"}}),
            json!({"type": "text", "text": "ignored while a tool call is pending"}),
        ];
        match parse_agent_response(&content) {
            StepResult::ToolCalls(calls) => {
                assert_eq!(calls.len(), 1);
                let AgentTurn::ToolCall { call_id, name, arguments } = &calls[0] else {
                    panic!("expected a ToolCall turn");
                };
                assert_eq!(call_id, "c1");
                assert_eq!(name, "propose_edit");
                let parsed: Value = serde_json::from_str(arguments).unwrap();
                assert_eq!(parsed["action"], "append");
            }
            StepResult::Done(_) => panic!("expected tool calls"),
        }
    }

    #[test]
    fn parse_agent_response_joins_text_blocks_when_no_tool_use() {
        let content = vec![json!({"type": "text", "text": "part one"}), json!({"type": "text", "text": "part two"})];
        match parse_agent_response(&content) {
            StepResult::Done(text) => assert_eq!(text, "part one\npart two"),
            StepResult::ToolCalls(_) => panic!("expected a final answer"),
        }
    }
}
