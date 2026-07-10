use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    model: &'static str,
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
    pub fn new(model: &'static str, instructions: String, user_text: String) -> Self {
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
            text: supports_verbosity(model).then_some(TextConfig { verbosity: "low" }),
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

pub async fn extract_response_text(res: reqwest::Response, provider_label: &str) -> Result<String, String> {
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("{provider_label} request failed ({status}): {text}"));
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
pub async fn read_streamed_output(res: reqwest::Response, provider_label: &str) -> Result<Vec<Value>, String> {
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("{provider_label} request failed ({status}): {text}"));
    }

    let body = res.text().await.map_err(|e| e.to_string())?;
    let mut output = Vec::new();

    for line in body.lines() {
        let Some(data) = line.strip_prefix("data: ") else { continue };
        let Ok(event) = serde_json::from_str::<Value>(data) else { continue };

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
