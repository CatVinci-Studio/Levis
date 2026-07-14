use crate::responses_api::{extract_response_text, ResponsesRequest};

const PUBLIC_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const PUBLIC_API_MODEL: &str = "gpt-5-nano";

/// Standard public OpenAI Responses API, authenticated with a plain user
/// API key rather than Codex OAuth - the fallback path for users who'd
/// rather paste a key than sign in with ChatGPT.
pub async fn call_completion(api_key: &str, instructions: String, user_text: String) -> Result<String, String> {
    let body = ResponsesRequest::new(PUBLIC_API_MODEL, instructions, user_text);

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
