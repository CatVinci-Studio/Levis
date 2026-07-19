use crate::agent::{AgentTurn, StepResult, ToolSpec};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Shared request/response shapes for OpenAI's Responses API - both the
/// Codex (chatgpt.com backend) and the plain public API key path send the
/// exact same body shape, they just differ in URL/model/auth headers.

#[derive(Serialize)]
struct TextConfig {
    verbosity: &'static str,
}

#[derive(Serialize)]
struct ContentPart {
    #[serde(rename = "type")]
    kind: &'static str,
    text: String,
}

#[derive(Serialize)]
struct InputMessage {
    role: &'static str,
    content: Vec<ContentPart>,
}

#[derive(Serialize)]
pub struct ResponsesRequest {
    model: String,
    store: bool,
    stream: bool,
    instructions: String,
    input: Vec<InputMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<TextConfig>,
}

/// `text.verbosity` is a GPT-5-only Responses API field - sending it to
/// older models (e.g. gpt-4o-mini) gets rejected with "Unknown parameter:
/// 'verbosity'". Gate it on the model name so any model can be plugged in
/// here without breaking the request.
fn supports_verbosity(model: &str) -> bool {
    model.starts_with("gpt-5")
}

impl ResponsesRequest {
    pub fn new(model: impl Into<String>, instructions: String, user_text: String) -> Self {
        let model = model.into();
        let text = supports_verbosity(&model).then_some(TextConfig { verbosity: "low" });
        Self {
            model,
            store: false,
            stream: false,
            instructions,
            input: vec![InputMessage {
                role: "user",
                content: vec![ContentPart {
                    kind: "input_text",
                    text: user_text,
                }],
            }],
            text,
        }
    }

    /// The ChatGPT backend (chatgpt.com/backend-api/codex/responses) rejects
    /// `stream: false` outright ("Stream must be set to true") - unlike the
    /// public api.openai.com/v1/responses endpoint, it only serves SSE.
    pub fn streaming(mut self) -> Self {
        self.stream = true;
        self
    }
}

#[derive(Deserialize, Default)]
struct OutputContent {
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize, Default)]
struct OutputItem {
    #[serde(default)]
    content: Vec<OutputContent>,
}

#[derive(Deserialize, Default)]
pub struct ResponsesResult {
    #[serde(default)]
    output: Vec<OutputItem>,
}

impl ResponsesResult {
    pub fn into_text(self) -> String {
        self.output
            .into_iter()
            .flat_map(|item| item.content)
            .find_map(|c| c.text)
            .unwrap_or_default()
    }
}

pub async fn extract_response_text(
    res: reqwest::Response,
    provider_label: &str,
) -> Result<String, String> {
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!(
            "{provider_label} request failed ({status}): {text}"
        ));
    }
    let parsed: ResponsesResult = res.json().await.map_err(|e| e.to_string())?;
    Ok(parsed.into_text())
}

/// Reads a `stream: true` Responses API SSE body and collects the completed
/// output items.
///
/// The `response.completed` event's `response.output` is unreliable (often
/// empty) on this backend, so instead this accumulates each
/// `response.output_item.done` event's `item` - which carries the same
/// message/function_call shape the non-streaming `output` array used to -
/// as they arrive.
pub async fn read_streamed_output(
    res: reqwest::Response,
    provider_label: &str,
) -> Result<Vec<Value>, String> {
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!(
            "{provider_label} request failed ({status}): {text}"
        ));
    }

    let body = res.text().await.map_err(|e| e.to_string())?;
    let mut output = Vec::new();

    for line in body.lines() {
        let Some(data) = line.strip_prefix("data: ") else {
            continue;
        };
        let Ok(event) = serde_json::from_str::<Value>(data) else {
            continue;
        };

        match event.get("type").and_then(|t| t.as_str()) {
            Some("response.output_item.done") => {
                if let Some(item) = event.get("item") {
                    output.push(item.clone());
                }
            }
            Some("response.failed") => {
                let error = event
                    .get("response")
                    .and_then(|r| r.get("error"))
                    .cloned()
                    .unwrap_or(event);
                return Err(format!("{provider_label} request failed: {error}"));
            }
            _ => {}
        }
    }

    Ok(output)
}

/// Extracts the assistant's text from a streamed output item list (see
/// [`read_streamed_output`]).
pub fn text_from_streamed_output(output: &[Value]) -> String {
    output
        .iter()
        .filter(|item| item.get("type").and_then(|t| t.as_str()) == Some("message"))
        .filter_map(|item| item.get("content").and_then(|c| c.as_array()))
        .flatten()
        .find_map(|part| part.get("text").and_then(|t| t.as_str()))
        .unwrap_or_default()
        .to_string()
}

// --- Agentic tool-calling support, shared by every Responses API dialect
// (Codex OAuth and the public API-key path) - see `crate::agent` for the
// provider-agnostic loop this feeds. A new Responses-API-shaped provider
// only needs its own auth/URL plumbing and can reuse everything below.

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
        AgentTurn::ToolCall {
            call_id,
            name,
            arguments,
        } => json!({
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

/// Builds a Responses API request body for one agent step: the full turn
/// history (mapped to `input` items) plus tool definitions. `streaming`
/// picks `stream: true`/`false` - the Codex backend only serves SSE, the
/// public API accepts either and non-streaming is simpler for callers that
/// don't need it.
pub fn agent_request_body(
    model: &str,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: bool,
    streaming: bool,
) -> Value {
    let input: Vec<Value> = history.iter().map(turn_to_input_item).collect();
    let mut tool_schemas: Vec<Value> = tools.iter().map(tool_to_schema).collect();
    // OpenAI's server-side web search: unlike function tools it runs inside
    // the response (search calls surface as ignored `web_search_call` output
    // items), so no loop changes are needed - just offering it is enough.
    if web_search {
        tool_schemas.push(json!({"type": "web_search"}));
    }

    let mut body = json!({
        "model": model,
        "store": false,
        "stream": streaming,
        "instructions": instructions,
        "input": input,
        "tools": tool_schemas,
        "tool_choice": "auto",
        "parallel_tool_calls": true,
    });
    if supports_verbosity(model) {
        body["text"] = json!({"verbosity": "low"});
    }
    body
}

/// Parses a Responses API `output` item array (streamed or not - both shapes
/// match) into a [`StepResult`]: any `function_call` items become tool
/// calls the caller must execute, otherwise the `message` items' text is the
/// model's final answer.
pub fn parse_agent_output(output: &[Value]) -> StepResult {
    let mut tool_calls = Vec::new();
    let mut text_parts = Vec::new();

    for item in output {
        match item.get("type").and_then(|t| t.as_str()) {
            Some("function_call") => {
                let call_id = item
                    .get("call_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let name = item
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let arguments = item
                    .get("arguments")
                    .and_then(|v| v.as_str())
                    .unwrap_or("{}");
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
        StepResult::ToolCalls(tool_calls)
    } else {
        StepResult::Done(text_parts.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_request_body_round_trips_every_turn_kind() {
        let history = vec![
            AgentTurn::User {
                text: "hi".to_string(),
            },
            AgentTurn::Assistant {
                text: "hello".to_string(),
            },
            AgentTurn::ToolCall {
                call_id: "c1".to_string(),
                name: "search_document".to_string(),
                arguments: "{}".to_string(),
            },
            AgentTurn::ToolResult {
                call_id: "c1".to_string(),
                output: "no matches".to_string(),
            },
        ];
        let tools = [ToolSpec {
            name: "search_document",
            description: "search",
            parameters: json!({"type": "object"}),
        }];

        let body = agent_request_body("gpt-5-mini", "be helpful", &history, &tools, false, true);

        assert_eq!(body["model"], "gpt-5-mini");
        assert_eq!(body["stream"], true);
        assert_eq!(body["input"].as_array().unwrap().len(), 4);
        assert_eq!(body["input"][2]["type"], "function_call");
        assert_eq!(body["input"][2]["call_id"], "c1");
        assert_eq!(body["input"][3]["type"], "function_call_output");
        assert_eq!(body["tools"].as_array().unwrap().len(), 1);
        assert_eq!(body["tools"][0]["name"], "search_document");
        // gpt-5* models get the verbosity hint, older ones don't.
        assert_eq!(body["text"]["verbosity"], "low");
    }

    #[test]
    fn agent_request_body_appends_web_search_tool_and_skips_verbosity_on_old_models() {
        let body = agent_request_body("gpt-4o-mini", "be helpful", &[], &[], true, false);
        assert_eq!(body["tools"].as_array().unwrap().len(), 1);
        assert_eq!(body["tools"][0]["type"], "web_search");
        assert!(body.get("text").is_none());
    }

    #[test]
    fn parse_agent_output_prefers_tool_calls_over_text() {
        let output = vec![
            json!({"type": "function_call", "call_id": "c1", "name": "propose_edit", "arguments": "{\"action\":\"append\"}"}),
            json!({"type": "message", "content": [{"text": "ignored while a tool call is pending"}]}),
        ];
        match parse_agent_output(&output) {
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
    fn parse_agent_output_joins_message_text_when_no_tool_calls() {
        let output = vec![
            json!({"type": "message", "content": [{"text": "part one"}, {"text": "part two"}]}),
        ];
        match parse_agent_output(&output) {
            StepResult::Done(text) => assert_eq!(text, "part one\npart two"),
            StepResult::ToolCalls(_) => panic!("expected a final answer"),
        }
    }
}
