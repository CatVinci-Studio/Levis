use aicompat::providers::{anthropic, custom, openai_api_key, openai_codex};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

const NOT_CONFIGURED: &str = "This provider isn't set up yet - configure it in Settings.";

pub(crate) async fn call(
    app: &AppHandle,
    provider: &str,
    instructions: String,
    user_text: String,
) -> Result<String, String> {
    match provider {
        "codex" => {
            let (access_token, account_id) = crate::auth::openai_codex::get_valid_credential(app)
                .await
                .map_err(|_| NOT_CONFIGURED.to_string())?;
            openai_codex::call_completion(
                &access_token,
                &account_id,
                crate::app_identity::ORIGINATOR,
                instructions,
                user_text,
            )
            .await
        }
        "claude" => {
            let access_token = crate::auth::claude::get_valid_credential(app)
                .await
                .map_err(|_| NOT_CONFIGURED.to_string())?;
            anthropic::call_completion(&access_token, instructions, user_text).await
        }
        "apikey" => {
            let key = crate::auth::api_key::load_api_key(app)?.ok_or_else(|| NOT_CONFIGURED.to_string())?;
            openai_api_key::call_completion(&key, instructions, user_text).await
        }
        "custom" => {
            let config =
                crate::auth::custom_endpoint::load_custom_endpoint(app)?.ok_or_else(|| NOT_CONFIGURED.to_string())?;
            custom::call_completion(
                &config.base_url,
                config.api_key.as_deref(),
                &config.model,
                instructions,
                user_text,
            )
            .await
        }
        other => Err(format!("unknown provider: {other}")),
    }
}

// The completion contract, end to end:
//   - context: the frontend sends the LAST 2000 characters of the document
//     (ghost-text-plugin's MAX_CONTEXT_CHARS), and only once the document
//     has at least 20 words/CJK chars of content.
//   - length: capped by instruction to one sentence / ~25 words - inline
//     ghost text is a nudge, not a paragraph generator.
const COMPLETION_INSTRUCTIONS: &str = "You are a writing assistant embedded in a markdown editor, providing inline autocomplete as the user types (like GitHub Copilot, but for prose). Continue the document naturally from exactly where the given text leaves off. Reply with ONLY the continuation text - no explanations, no markdown fences, no repeating the input. Hard length limit: at most ONE sentence, and no more than about 25 words (or ~30 characters for CJK text). Prefer completing the current phrase or sentence over starting a new one.";

#[tauri::command]
pub async fn ai_complete(app: AppHandle, provider: String, context: String) -> Result<String, String> {
    call(&app, &provider, COMPLETION_INSTRUCTIONS.to_string(), context).await
}

const GRAMMAR_INSTRUCTIONS: &str = "You are a grammar and clarity checker embedded in a markdown editor. You will be given a single paragraph of plain text. Find grammar mistakes, typos, or awkward phrasing. Respond with ONLY a JSON array (no markdown fences, no explanation, no surrounding text) of objects shaped like: [{\"start\": <0-indexed char offset, inclusive>, \"end\": <0-indexed char offset, exclusive>, \"issue\": \"short description\", \"suggestion\": \"replacement text for that span\"}]. Offsets must index into the exact paragraph text given, counting Unicode scalar values left to right. If there are no issues, respond with exactly: []";

#[derive(Deserialize, Serialize, Clone)]
pub struct GrammarIssue {
    start: usize,
    end: usize,
    issue: String,
    suggestion: String,
}

fn extract_json_array(text: &str) -> Option<&str> {
    let start = text.find('[')?;
    let end = text.rfind(']')?;
    if end < start {
        return None;
    }
    Some(&text[start..=end])
}

#[tauri::command]
pub async fn ai_grammar_check(app: AppHandle, provider: String, paragraph: String) -> Result<Vec<GrammarIssue>, String> {
    let raw = call(&app, &provider, GRAMMAR_INSTRUCTIONS.to_string(), paragraph.clone()).await?;
    let json_slice = extract_json_array(&raw).ok_or_else(|| "no JSON array in model response".to_string())?;
    let issues: Vec<GrammarIssue> = serde_json::from_str(json_slice).map_err(|e| e.to_string())?;

    let len = paragraph.chars().count();
    Ok(issues.into_iter().filter(|i| i.start < i.end && i.end <= len).collect())
}
