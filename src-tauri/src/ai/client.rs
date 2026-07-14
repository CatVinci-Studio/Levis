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
//   - context: the frontend sends the text around the CURSOR - up to the
//     last 2000 chars before it and the first 500 after (ghost-text-plugin's
//     MAX_CONTEXT_CHARS / MAX_AFTER_CONTEXT_CHARS), and only once there are
//     at least 20 words/CJK chars before the cursor. Cursor-anchored, not
//     document-anchored: completing mid-document must continue from the
//     cursor, not from wherever the document happens to end.
//   - length: capped by instruction to one sentence / ~25 words - inline
//     ghost text is a nudge, not a paragraph generator.
/// Mirrors the frontend's proxy setting into aicompat's shared HTTP client.
/// Settings live in the frontend's localStorage, which Rust can't read (same
/// mirroring precedent as commands::prefs), so the frontend re-sends this on
/// startup and on every change. Rejects unparseable proxy URLs.
#[tauri::command]
pub fn set_ai_proxy(proxy: Option<String>) -> Result<(), String> {
    aicompat::http::set_proxy(proxy)
}

const COMPLETION_INSTRUCTIONS: &str = "You are a writing assistant embedded in a markdown editor, providing inline autocomplete at the user's cursor (like GitHub Copilot, but for prose). The input marks the insertion point: the text inside <text-before-cursor> ends exactly at the cursor, and the text inside <text-after-cursor> starts exactly at the cursor (it may be empty). Write ONLY the text to insert at the cursor: it must continue seamlessly from the exact end of the before-text, and where after-text exists it must lead into it naturally without repeating any of it. No explanations, no markdown fences, no repeating the input. Hard length limit: at most ONE sentence, and no more than about 25 words (or ~30 characters for CJK text). Prefer completing the current phrase or sentence over starting a new one.";

#[tauri::command]
pub async fn ai_complete(
    app: AppHandle,
    provider: String,
    before: String,
    after: String,
    style: Option<String>,
) -> Result<String, String> {
    // No whitespace between the tags and the text - the before-text must end
    // exactly at the cursor for "continue from the exact end" to mean
    // anything.
    let user_text =
        format!("<text-before-cursor>{before}</text-before-cursor>\n<text-after-cursor>{after}</text-after-cursor>");
    // The user's tone/style preferences (from Settings) ride along after the
    // base contract so they can shape the wording without being able to
    // override the format and length rules above them.
    let instructions = match style.as_deref().map(str::trim) {
        Some(style) if !style.is_empty() => format!(
            "{COMPLETION_INSTRUCTIONS}\n\nStyle preferences from the user (follow them where they don't conflict with the rules above): {style}"
        ),
        _ => COMPLETION_INSTRUCTIONS.to_string(),
    };
    call(&app, &provider, instructions, user_text).await
}

const GRAMMAR_INSTRUCTIONS: &str = "You are a grammar and clarity checker embedded in a markdown editor. You will be given a single paragraph of plain text. Respond with ONLY a JSON array (no markdown fences, no explanation, no surrounding text) of objects shaped like: [{\"start\": <0-indexed char offset, inclusive>, \"end\": <0-indexed char offset, exclusive>, \"original\": \"the exact text of that span, copied verbatim from the paragraph\", \"context\": \"the span plus a few words of surrounding paragraph text on each side, copied verbatim - REQUIRED whenever the span's text occurs more than once in the paragraph\", \"issue\": \"short description\", \"suggestion\": \"replacement text for that span\"}]. Offsets must index into the exact paragraph text given, counting Unicode scalar values left to right. `suggestion` replaces `original` exactly - it must not repeat surrounding text that is outside the span. Write `issue` in the same language as the paragraph. If there are no issues, respond with exactly: []";

/// The scope limit appended per strictness level - what the check is allowed
/// to report. Unknown/absent values fall back to "standard".
fn strictness_instructions(strictness: Option<&str>) -> &'static str {
    match strictness {
        Some("typos") => "Scope: report ONLY unambiguous typos, misspellings and wrong characters you are certain about. Do not report grammar, phrasing or style.",
        Some("strict") => "Scope: report typos, grammar mistakes, and additionally redundancy, ambiguity and unclear phrasing worth tightening.",
        _ => "Scope: report typos and clear grammar mistakes. Do not report stylistic preferences or optional rephrasing.",
    }
}

#[derive(Deserialize, Serialize, Clone)]
pub struct GrammarIssue {
    start: usize,
    end: usize,
    issue: String,
    suggestion: String,
    /// The span's exact text as the model saw it. Models routinely get char
    /// offsets wrong (especially in CJK text) while quoting the span itself
    /// correctly, so this is the ground truth offsets are checked against -
    /// and what the frontend re-verifies at apply time.
    #[serde(default)]
    original: Option<String>,
    /// The span plus a little verbatim surrounding text - disambiguates
    /// which occurrence is meant when `original` repeats in the paragraph.
    /// Never sent to the frontend; only used to repair offsets here.
    #[serde(default, skip_serializing)]
    context: Option<String>,
}

fn extract_json_array(text: &str) -> Option<&str> {
    let start = text.find('[')?;
    let end = text.rfind(']')?;
    if end < start {
        return None;
    }
    Some(&text[start..=end])
}

/// Char range (in Unicode scalar values) of `needle` in `haystack`, but only
/// when it occurs exactly once - an ambiguous match can't be trusted to be
/// the span the model meant.
fn unique_char_range(haystack: &str, needle: &str) -> Option<(usize, usize)> {
    if needle.is_empty() {
        return None;
    }
    let mut it = haystack.match_indices(needle);
    let (byte_start, _) = it.next()?;
    if it.next().is_some() {
        return None;
    }
    let start = haystack[..byte_start].chars().count();
    Some((start, start + needle.chars().count()))
}

/// Char range of `needle` located through `context`: the context must occur
/// exactly once in the paragraph and contain the needle - that pins down
/// which occurrence of a repeated span the model meant.
fn context_char_range(haystack: &str, needle: &str, context: &str) -> Option<(usize, usize)> {
    if needle.is_empty() || context.len() <= needle.len() {
        return None;
    }
    let (context_start, _) = {
        let mut it = haystack.match_indices(context);
        let first = it.next()?;
        if it.next().is_some() {
            return None;
        }
        first
    };
    let byte_start = context_start + context.find(needle)?;
    let start = haystack[..byte_start].chars().count();
    Some((start, start + needle.chars().count()))
}

/// Keeps only issues whose span is verifiably correct: the model's `original`
/// quote is the ground truth. Offsets that disagree with the quote are
/// repaired by relocating the quote (applying a fix with a misplaced span is
/// what used to duplicate text); issues whose quote can't be located exactly
/// once are dropped. `original` is filled in on every surviving issue so the
/// frontend can re-verify before applying.
fn validate_issues(issues: Vec<GrammarIssue>, paragraph: &str) -> Vec<GrammarIssue> {
    let chars: Vec<char> = paragraph.chars().collect();
    issues
        .into_iter()
        .filter_map(|mut issue| {
            let offsets_valid = issue.start < issue.end && issue.end <= chars.len();
            let span: Option<String> = offsets_valid.then(|| chars[issue.start..issue.end].iter().collect());
            match (&issue.original, span) {
                (Some(original), Some(span)) if *original == span => Some(issue),
                (Some(original), _) => {
                    // Offsets disagree with the quote - relocate the quote,
                    // falling back to the model's `context` when the quote
                    // alone is ambiguous (repeated text).
                    let (start, end) = unique_char_range(paragraph, original).or_else(|| {
                        let context = issue.context.as_deref()?;
                        context_char_range(paragraph, original, context)
                    })?;
                    issue.start = start;
                    issue.end = end;
                    Some(issue)
                }
                // Legacy shape (no `original`): trust in-bounds offsets and
                // record the span they cover for the frontend's apply check.
                (None, Some(span)) => {
                    issue.original = Some(span);
                    Some(issue)
                }
                (None, None) => None,
            }
        })
        .collect()
}

#[tauri::command]
pub async fn ai_grammar_check(
    app: AppHandle,
    provider: String,
    paragraph: String,
    strictness: Option<String>,
) -> Result<Vec<GrammarIssue>, String> {
    let instructions = format!(
        "{GRAMMAR_INSTRUCTIONS}\n\n{}",
        strictness_instructions(strictness.as_deref())
    );
    let raw = call(&app, &provider, instructions, paragraph.clone()).await?;
    let json_slice = extract_json_array(&raw).ok_or_else(|| "no JSON array in model response".to_string())?;
    let issues: Vec<GrammarIssue> = serde_json::from_str(json_slice).map_err(|e| e.to_string())?;
    Ok(validate_issues(issues, &paragraph))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn issue(start: usize, end: usize, original: Option<&str>) -> GrammarIssue {
        GrammarIssue {
            start,
            end,
            issue: "test".to_string(),
            suggestion: "x".to_string(),
            original: original.map(|s| s.to_string()),
            context: None,
        }
    }

    #[test]
    fn keeps_issue_when_offsets_match_quote() {
        let out = validate_issues(vec![issue(2, 4, Some("cd"))], "abcdef");
        assert_eq!(out.len(), 1);
        assert_eq!((out[0].start, out[0].end), (2, 4));
    }

    #[test]
    fn repairs_wrong_offsets_from_quote_cjk() {
        // The model quoted the right span but miscounted CJK offsets - the
        // pre-fix behavior applied these bad offsets and duplicated text.
        let out = validate_issues(vec![issue(1, 3, Some("语法检查"))], "中文语法检查测试");
        assert_eq!(out.len(), 1);
        assert_eq!((out[0].start, out[0].end), (2, 6));
    }

    #[test]
    fn drops_issue_when_relocation_is_ambiguous_or_absent() {
        // Offsets disagree with the quote, and the quote can't be relocated
        // unambiguously (or at all) - nothing trustworthy to apply.
        assert!(validate_issues(vec![issue(1, 3, Some("ab"))], "ab ab").is_empty());
        assert!(validate_issues(vec![issue(0, 2, Some("zz"))], "abcdef").is_empty());
    }

    #[test]
    fn context_disambiguates_repeated_span() {
        // Offsets disagree with the quote and the quote appears twice; the
        // model's context pins the second occurrence.
        let mut with_context = issue(1, 3, Some("ab"));
        with_context.context = Some("cd ab ef".to_string());
        let out = validate_issues(vec![with_context], "ab cd ab ef");
        assert_eq!(out.len(), 1);
        assert_eq!((out[0].start, out[0].end), (6, 8));
    }

    #[test]
    fn ambiguous_context_is_dropped() {
        // The context itself repeats too - still nothing trustworthy.
        let mut with_context = issue(1, 3, Some("ab"));
        with_context.context = Some("ab cd".to_string());
        assert!(validate_issues(vec![with_context], "ab cd ab cd").is_empty());
    }

    #[test]
    fn legacy_issue_without_quote_gets_span_recorded() {
        let out = validate_issues(vec![issue(2, 4, None)], "abcdef");
        assert_eq!(out[0].original.as_deref(), Some("cd"));
    }

    #[test]
    fn drops_legacy_issue_with_out_of_bounds_offsets() {
        assert!(validate_issues(vec![issue(4, 2, None)], "abcdef").is_empty());
        assert!(validate_issues(vec![issue(0, 99, None)], "abcdef").is_empty());
    }
}
