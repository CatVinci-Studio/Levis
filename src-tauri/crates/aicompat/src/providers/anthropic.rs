use crate::agent::{AgentTurn, EventSink, ProviderEvent, StepResult, ToolSpec};
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
/// Low-cost default for completion and grammar requests. Agent chat chooses
/// its stronger default from the provider catalog.
pub const COMPLETION_MODEL: &str = "claude-haiku-4-5-20251001";
const CLAUDE_CODE_IDENTITY: &str = "You are Claude Code, Anthropic's official CLI for Claude.";

#[derive(Serialize, Deserialize, Clone)]
pub struct ClaudeCredential {
    pub access: String,
    pub refresh: String,
    /// ms since epoch
    pub expires: i64,
}

/// The two ways this dialect authenticates. OAuth (Claude Code) tokens are
/// only accepted with the Claude Code identity headers and system prompt
/// they're scoped to; a plain API key uses the standard `x-api-key` header
/// and must NOT claim that identity.
#[derive(Clone)]
pub enum AnthropicAuth {
    Oauth(String),
    ApiKey(String),
}

fn apply_auth(req: reqwest::RequestBuilder, auth: &AnthropicAuth) -> reqwest::RequestBuilder {
    let req = req.header("anthropic-version", "2023-06-01");
    match auth {
        AnthropicAuth::Oauth(token) => req
            .bearer_auth(token)
            .header("anthropic-beta", "claude-code-20250219,oauth-2025-04-20")
            .header("anthropic-dangerous-direct-browser-access", "true")
            .header("user-agent", "claude-cli/1.0.0")
            .header("x-app", "cli"),
        AnthropicAuth::ApiKey(key) => req.header("x-api-key", key),
    }
}

fn system_blocks(instructions: String, auth: &AnthropicAuth) -> Vec<SystemBlock> {
    let mut blocks = Vec::new();
    if matches!(auth, AnthropicAuth::Oauth(_)) {
        blocks.push(SystemBlock {
            kind: "text",
            text: CLAUDE_CODE_IDENTITY.to_string(),
        });
    }
    blocks.push(SystemBlock {
        kind: "text",
        text: instructions,
    });
    blocks
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

pub async fn exchange_code(
    code: &str,
    state: &str,
    verifier: &str,
) -> Result<ClaudeCredential, String> {
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

    Ok(credential_from_token(
        res.json().await.map_err(|e| e.to_string())?,
    ))
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

    Ok(credential_from_token(
        res.json().await.map_err(|e| e.to_string())?,
    ))
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

/// Calls the standard public Anthropic Messages API with either auth kind.
/// `model` overrides COMPLETION_MODEL when set.
pub async fn call_completion(
    auth: &AnthropicAuth,
    instructions: String,
    user_text: String,
    model: Option<&str>,
) -> Result<String, String> {
    let body = MessagesRequest {
        model: model.unwrap_or(COMPLETION_MODEL).to_string(),
        max_tokens: 1024,
        system: system_blocks(instructions, auth),
        messages: vec![Message {
            role: "user",
            content: user_text,
        }],
    };

    let client = crate::http::client();
    let res = apply_auth(client.post(MESSAGES_URL), auth)
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
    Ok(parsed
        .content
        .into_iter()
        .find_map(|c| c.text)
        .unwrap_or_default())
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
pub async fn list_models(auth: &AnthropicAuth) -> Result<Vec<String>, String> {
    let client = crate::http::client();
    let res = apply_auth(client.get("https://api.anthropic.com/v1/models"), auth)
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
                        AgentTurn::ToolCall {
                            call_id,
                            name,
                            arguments,
                        } => {
                            let input: Value =
                                serde_json::from_str(arguments).unwrap_or_else(|_| json!({}));
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
                let name = block
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let arguments = block
                    .get("input")
                    .cloned()
                    .unwrap_or_else(|| json!({}))
                    .to_string();
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

/// One in-flight content block while a streamed Messages response is being
/// read. Only the kinds parse_agent_response cares about get accumulated;
/// everything else (server_tool_use, web_search results, thinking) stays
/// Ignored, exactly as the non-streaming path ignores those block types.
enum StreamBlock {
    Text(String),
    ToolUse {
        id: String,
        name: String,
        /// input_json_delta fragments, concatenated - parsed once at the end.
        args: String,
    },
    Ignored,
}

/// Rebuilds the non-streaming response's `content` array from Messages API
/// SSE events, reporting fragments through `on_event` as they arrive. Kept
/// separate from the HTTP read so the event-to-block bookkeeping is unit
/// testable with plain JSON fixtures.
#[derive(Default)]
struct StreamAccumulator {
    blocks: Vec<StreamBlock>,
    error: Option<String>,
}

impl StreamAccumulator {
    fn block_at(&mut self, index: usize) -> &mut StreamBlock {
        while self.blocks.len() <= index {
            self.blocks.push(StreamBlock::Ignored);
        }
        &mut self.blocks[index]
    }

    fn apply(&mut self, data: &str, on_event: EventSink<'_>) {
        if self.error.is_some() {
            return;
        }
        let Ok(event) = serde_json::from_str::<Value>(data) else {
            return;
        };
        let index = event.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;

        match event.get("type").and_then(|t| t.as_str()) {
            Some("content_block_start") => {
                let Some(block) = event.get("content_block") else {
                    return;
                };
                match block.get("type").and_then(|t| t.as_str()) {
                    Some("text") => *self.block_at(index) = StreamBlock::Text(String::new()),
                    Some("tool_use") => {
                        let id = block.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                        let name = block
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default();
                        on_event(ProviderEvent::ToolStart { call_id: id, name });
                        *self.block_at(index) = StreamBlock::ToolUse {
                            id: id.to_string(),
                            name: name.to_string(),
                            args: String::new(),
                        };
                    }
                    _ => *self.block_at(index) = StreamBlock::Ignored,
                }
            }
            Some("content_block_delta") => {
                let Some(delta) = event.get("delta") else {
                    return;
                };
                match delta.get("type").and_then(|t| t.as_str()) {
                    Some("text_delta") => {
                        let Some(text) = delta.get("text").and_then(|t| t.as_str()) else {
                            return;
                        };
                        if let StreamBlock::Text(buf) = self.block_at(index) {
                            buf.push_str(text);
                            on_event(ProviderEvent::Text(text));
                        }
                    }
                    Some("input_json_delta") => {
                        let Some(part) = delta.get("partial_json").and_then(|t| t.as_str()) else {
                            return;
                        };
                        if let StreamBlock::ToolUse { id, args, .. } = self.block_at(index) {
                            args.push_str(part);
                            let call_id = id.clone();
                            on_event(ProviderEvent::ToolArgs {
                                call_id: &call_id,
                                delta: part,
                            });
                        }
                    }
                    _ => {}
                }
            }
            Some("error") => {
                let error = event.get("error").cloned().unwrap_or(event.clone());
                self.error = Some(format!("Claude request failed: {error}"));
            }
            _ => {}
        }
    }

    fn into_content(self) -> Vec<Value> {
        self.blocks
            .into_iter()
            .filter_map(|block| match block {
                StreamBlock::Text(text) => Some(json!({"type": "text", "text": text})),
                StreamBlock::ToolUse { id, name, args } => {
                    let input: Value = serde_json::from_str(&args).unwrap_or_else(|_| json!({}));
                    Some(json!({"type": "tool_use", "id": id, "name": name, "input": input}))
                }
                StreamBlock::Ignored => None,
            })
            .collect()
    }
}

/// Runs one round-trip against Claude with the full turn history and tool
/// definitions - the Anthropic twin of `openai_codex::agent_step`. Streams
/// (`stream: true`) so text and tool-call fragments surface through
/// `on_event` as they're generated.
pub async fn agent_step(
    auth: &AnthropicAuth,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: bool,
    model: &str,
    on_event: EventSink<'_>,
) -> Result<StepResult, String> {
    let system: Vec<Value> = system_blocks(instructions.to_string(), auth)
        .iter()
        .map(|b| json!({"type": b.kind, "text": b.text}))
        .collect();
    let mut tool_schemas = tools.iter().map(tool_to_schema).collect::<Vec<_>>();
    // Claude executes this server tool inside the Messages request. Its
    // server_tool_use/result blocks are intentionally ignored by
    // parse_agent_response; the final cited text blocks are still retained.
    if web_search {
        tool_schemas.push(json!({
            "type": "web_search_20250305",
            "name": "web_search",
            "max_uses": 5,
        }));
    }
    let body = json!({
        "model": model,
        "max_tokens": 4096,
        "stream": true,
        "system": system,
        "messages": turns_to_messages(history),
        "tools": tool_schemas,
    });

    let client = crate::http::streaming_client();
    let res = apply_auth(client.post(MESSAGES_URL), auth)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let mut acc = StreamAccumulator::default();
    crate::http::read_sse(res, "Claude", |data| acc.apply(data, on_event)).await?;
    if let Some(error) = acc.error {
        return Err(error);
    }
    Ok(parse_agent_response(&acc.into_content()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turns_to_messages_maps_plain_turns_1_to_1() {
        let history = vec![
            AgentTurn::User {
                text: "hi".to_string(),
            },
            AgentTurn::Assistant {
                text: "hello".to_string(),
            },
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
            AgentTurn::User {
                text: "do it".to_string(),
            },
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
            AgentTurn::Assistant {
                text: "done".to_string(),
            },
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
                let AgentTurn::ToolCall {
                    call_id,
                    name,
                    arguments,
                } = &calls[0]
                else {
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

    /// Feeds SSE data payloads through the accumulator, collecting the
    /// events it reports as "T:text", "S:id:name", "A:id:delta" strings.
    fn run_stream(events: &[Value]) -> (StreamAccumulator, Vec<String>) {
        let reported = std::sync::Mutex::new(Vec::new());
        let sink = |e: ProviderEvent<'_>| {
            reported.lock().unwrap().push(match e {
                ProviderEvent::Text(t) => format!("T:{t}"),
                ProviderEvent::ToolStart { call_id, name } => format!("S:{call_id}:{name}"),
                ProviderEvent::ToolArgs { call_id, delta } => format!("A:{call_id}:{delta}"),
            });
        };
        let mut acc = StreamAccumulator::default();
        for event in events {
            acc.apply(&event.to_string(), &sink);
        }
        let reported = reported.into_inner().unwrap();
        (acc, reported)
    }

    #[test]
    fn stream_accumulator_rebuilds_text_and_tool_use_blocks() {
        let (acc, events) = run_stream(&[
            json!({"type": "message_start"}),
            json!({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "I'll "}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "fix that."}}),
            json!({"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "tu_1", "name": "propose_edit"}}),
            json!({"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"action\":"}}),
            json!({"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "\"append\",\"text\":\"hi\"}"}}),
            json!({"type": "content_block_stop", "index": 1}),
            json!({"type": "message_stop"}),
        ]);

        assert_eq!(
            events,
            vec![
                "T:I'll ",
                "T:fix that.",
                "S:tu_1:propose_edit",
                "A:tu_1:{\"action\":",
                "A:tu_1:\"append\",\"text\":\"hi\"}",
            ]
        );

        let content = acc.into_content();
        assert_eq!(content[0], json!({"type": "text", "text": "I'll fix that."}));
        assert_eq!(content[1]["type"], "tool_use");
        assert_eq!(content[1]["input"]["action"], "append");
        // The rebuilt content parses exactly like a non-streamed response.
        match parse_agent_response(&content) {
            StepResult::ToolCalls(calls) => assert_eq!(calls.len(), 1),
            StepResult::Done(_) => panic!("expected tool calls"),
        }
    }

    #[test]
    fn stream_accumulator_ignores_server_tool_blocks_and_reports_errors() {
        let (acc, events) = run_stream(&[
            json!({"type": "content_block_start", "index": 0, "content_block": {"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search"}}),
            json!({"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}}),
            json!({"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "answer"}}),
            json!({"type": "error", "error": {"type": "overloaded_error", "message": "busy"}}),
            json!({"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "after error, ignored"}}),
        ]);
        assert_eq!(events, vec!["T:answer"]);
        assert!(acc.error.as_deref().unwrap().contains("overloaded_error"));
    }

    #[test]
    fn parse_agent_response_joins_text_blocks_when_no_tool_use() {
        let content = vec![
            json!({"type": "text", "text": "part one"}),
            json!({"type": "text", "text": "part two"}),
        ];
        match parse_agent_response(&content) {
            StepResult::Done(text) => assert_eq!(text, "part one\npart two"),
            StepResult::ToolCalls(_) => panic!("expected a final answer"),
        }
    }
}
