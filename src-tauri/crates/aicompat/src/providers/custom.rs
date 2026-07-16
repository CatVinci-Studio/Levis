use crate::agent::{AgentTurn, StepResult, ToolSpec};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

fn chat_completions_url(base_url: &str) -> String {
    format!("{}/chat/completions", base_url.trim_end_matches('/'))
}

fn models_url(base_url: &str) -> String {
    format!("{}/models", base_url.trim_end_matches('/'))
}

#[derive(Serialize)]
struct ChatMessage {
    role: &'static str,
    content: String,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
}

#[derive(Deserialize, Default)]
struct ChatChoiceMessage {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Deserialize, Default)]
struct ChatChoice {
    #[serde(default)]
    message: ChatChoiceMessage,
}

#[derive(Deserialize, Default)]
struct ChatResponse {
    #[serde(default)]
    choices: Vec<ChatChoice>,
}

/// Custom endpoints (self-hosted, local models, third-party OpenAI-compatible
/// servers) most reliably support the older `/chat/completions` shape rather
/// than the newer Responses API, which fewer non-OpenAI servers implement.
pub async fn call_completion(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    instructions: String,
    user_text: String,
) -> Result<String, String> {
    let body = ChatRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage {
                role: "system",
                content: instructions,
            },
            ChatMessage {
                role: "user",
                content: user_text,
            },
        ],
    };

    let client = crate::http::client();
    let mut req = client.post(chat_completions_url(base_url)).json(&body);
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }

    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Custom endpoint request failed ({status}): {text}"));
    }

    let parsed: ChatResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(parsed
        .choices
        .into_iter()
        .find_map(|c| c.message.content)
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

/// Lists models from an OpenAI-compatible `/models` endpoint. Also doubles
/// as the "test connection" check - if this succeeds, the endpoint is
/// reachable and credentials work.
pub async fn list_models(base_url: &str, api_key: Option<&str>) -> Result<Vec<String>, String> {
    let client = crate::http::client();
    let mut req = client.get(models_url(base_url));
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }

    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Could not list models ({status}): {text}"));
    }

    let parsed: ModelListResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(parsed.data.into_iter().map(|m| m.id).collect())
}

// --- Agentic tool-calling support (the generic openai-chat-completions
// dialect - see `aicompat::agent` for the provider-agnostic loop this
// feeds). This is the dialect self-hosted models, OpenRouter, Groq, Ollama,
// and most other OpenAI-compatible servers speak - unlike the Responses API
// and Messages API dialects, `tools` support here varies a lot server to
// server, so the caller (agent.rs) is expected to fall back to
// `call_completion` on a hard failure rather than this module guessing.

fn tool_to_schema(tool: &ToolSpec) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.parameters,
        },
    })
}

/// Groups the flat `AgentTurn` history into Chat Completions messages.
/// Like the Anthropic dialect, every `ToolCall` in a run must land in ONE
/// assistant message's `tool_calls` array - but each `ToolResult` becomes
/// its OWN `role: "tool"` message afterward (not grouped into one, unlike
/// Anthropic's `tool_result` content blocks), matching what
/// api.openai.com/v1/chat/completions and compatible servers expect.
fn turns_to_messages(instructions: &str, history: &[AgentTurn]) -> Vec<Value> {
    let mut messages = vec![json!({"role": "system", "content": instructions})];
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
                let mut tool_calls = Vec::new();
                let mut tool_results = Vec::new();
                while let Some(turn) = history.get(i) {
                    match turn {
                        AgentTurn::ToolCall { call_id, name, arguments } => {
                            tool_calls.push(json!({
                                "id": call_id,
                                "type": "function",
                                "function": { "name": name, "arguments": arguments },
                            }));
                            i += 1;
                        }
                        AgentTurn::ToolResult { call_id, output } => {
                            tool_results.push((call_id.clone(), output.clone()));
                            i += 1;
                        }
                        _ => break,
                    }
                }
                if !tool_calls.is_empty() {
                    messages.push(json!({"role": "assistant", "content": Value::Null, "tool_calls": tool_calls}));
                }
                for (call_id, output) in tool_results {
                    messages.push(json!({"role": "tool", "tool_call_id": call_id, "content": output}));
                }
            }
        }
    }
    messages
}

/// Parses a Chat Completions `choices[0].message` object into a
/// [`StepResult`]: any `tool_calls` become tool calls the caller must
/// execute, otherwise `content` is the model's final answer.
fn parse_agent_response(message: &Value) -> StepResult {
    let calls: Vec<AgentTurn> = message
        .get("tool_calls")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|tc| {
            let call_id = tc.get("id")?.as_str()?.to_string();
            let func = tc.get("function")?;
            let name = func.get("name")?.as_str()?.to_string();
            let arguments = func.get("arguments").and_then(|a| a.as_str()).unwrap_or("{}").to_string();
            Some(AgentTurn::ToolCall { call_id, name, arguments })
        })
        .collect();

    if !calls.is_empty() {
        return StepResult::ToolCalls(calls);
    }
    StepResult::Done(message.get("content").and_then(|c| c.as_str()).unwrap_or_default().to_string())
}

/// Runs one round-trip against a Chat Completions-compatible endpoint with
/// tool definitions - the generic-dialect twin of `openai_codex::agent_step`.
pub async fn agent_step(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
) -> Result<StepResult, String> {
    let body = json!({
        "model": model,
        "messages": turns_to_messages(instructions, history),
        "tools": tools.iter().map(tool_to_schema).collect::<Vec<_>>(),
        "tool_choice": "auto",
    });

    let client = crate::http::client();
    let mut req = client.post(chat_completions_url(base_url)).json(&body);
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Custom endpoint request failed ({status}): {text}"));
    }

    let parsed: Value = res.json().await.map_err(|e| e.to_string())?;
    let message = parsed
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|c| c.first())
        .and_then(|c| c.get("message"))
        .cloned()
        .unwrap_or(Value::Null);
    Ok(parse_agent_response(&message))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turns_to_messages_starts_with_system_and_groups_tool_turns() {
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

        let messages = turns_to_messages("be helpful", &history);
        // system, user, assistant(tool_calls x2), tool, tool, assistant
        assert_eq!(messages.len(), 6);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[0]["content"], "be helpful");
        assert_eq!(messages[1]["role"], "user");

        assert_eq!(messages[2]["role"], "assistant");
        let tool_calls = messages[2]["tool_calls"].as_array().unwrap();
        assert_eq!(tool_calls.len(), 2);
        assert_eq!(tool_calls[0]["id"], "1");
        assert_eq!(tool_calls[0]["function"]["name"], "search_document");
        assert_eq!(tool_calls[1]["id"], "2");

        assert_eq!(messages[3]["role"], "tool");
        assert_eq!(messages[3]["tool_call_id"], "1");
        assert_eq!(messages[3]["content"], "found a");
        assert_eq!(messages[4]["role"], "tool");
        assert_eq!(messages[4]["tool_call_id"], "2");

        assert_eq!(messages[5]["role"], "assistant");
        assert_eq!(messages[5]["content"], "done");
    }

    #[test]
    fn parse_agent_response_prefers_tool_calls_over_content() {
        let message = json!({
            "role": "assistant",
            "content": null,
            "tool_calls": [{
                "id": "c1",
                "type": "function",
                "function": { "name": "propose_edit", "arguments": "{\"action\":\"append\"}" },
            }],
        });
        match parse_agent_response(&message) {
            StepResult::ToolCalls(calls) => {
                assert_eq!(calls.len(), 1);
                let AgentTurn::ToolCall { call_id, name, .. } = &calls[0] else {
                    panic!("expected a ToolCall turn");
                };
                assert_eq!(call_id, "c1");
                assert_eq!(name, "propose_edit");
            }
            StepResult::Done(_) => panic!("expected tool calls"),
        }
    }

    #[test]
    fn parse_agent_response_falls_back_to_content() {
        let message = json!({ "role": "assistant", "content": "plain answer" });
        match parse_agent_response(&message) {
            StepResult::Done(text) => assert_eq!(text, "plain answer"),
            StepResult::ToolCalls(_) => panic!("expected a final answer"),
        }
    }
}
