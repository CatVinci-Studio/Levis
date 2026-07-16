use crate::agent::{AgentTurn, StepResult, ToolSpec};
use crate::responses_api::{self, extract_response_text, ResponsesRequest};

const PUBLIC_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
/// Also the agent loop's default model when the user hasn't picked one in
/// Settings - same default the plain completion path below uses.
pub const PUBLIC_API_MODEL: &str = "gpt-5-nano";

/// Standard public OpenAI Responses API, authenticated with a plain user
/// API key rather than Codex OAuth - the fallback path for users who'd
/// rather paste a key than sign in with ChatGPT. `model` overrides
/// PUBLIC_API_MODEL when set.
pub async fn call_completion(
    api_key: &str,
    instructions: String,
    user_text: String,
    model: Option<&str>,
) -> Result<String, String> {
    let body = ResponsesRequest::new(model.unwrap_or(PUBLIC_API_MODEL), instructions, user_text);

    let client = crate::http::client();
    let res = client
        .post(PUBLIC_RESPONSES_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    extract_response_text(res, "OpenAI").await
}

/// Runs one round-trip against the public Responses API with the full turn
/// history and tool definitions - the API-key twin of
/// `openai_codex::agent_step`, same wire format (see `responses_api`), just
/// authenticated with a plain key and answered non-streaming (this endpoint,
/// unlike the ChatGPT backend, accepts `stream: false`).
pub async fn agent_step(
    api_key: &str,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: bool,
    model: &str,
) -> Result<StepResult, String> {
    let body = responses_api::agent_request_body(model, instructions, history, tools, web_search, false);

    let client = crate::http::client();
    let res = client
        .post(PUBLIC_RESPONSES_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("OpenAI request failed ({status}): {text}"));
    }

    let parsed: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let output = parsed.get("output").and_then(|o| o.as_array()).cloned().unwrap_or_default();
    Ok(responses_api::parse_agent_output(&output))
}
