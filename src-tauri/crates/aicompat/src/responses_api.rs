use serde::{Deserialize, Serialize};

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
    text: TextConfig,
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
            text: TextConfig { verbosity: "low" },
        }
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
