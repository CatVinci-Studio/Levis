use crate::ai::catalog;
use crate::ai::route::{self, OpenaiAuth, NOT_CONFIGURED};
use aicompat::providers::{anthropic, custom, openai_api_key, openai_codex};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// `model` overrides the provider's default model; inline completion always
/// passes `None`, only the agent chat path sets it. Dispatches by dialect -
/// see `catalog::PROVIDER_CATALOG` for which id speaks which dialect, and
/// `ai::route` for how a provider resolves to actual credentials.
pub(crate) async fn call(
    app: &AppHandle,
    provider: &str,
    instructions: String,
    user_text: String,
    model: Option<&str>,
) -> Result<String, String> {
    let entry = catalog::find(provider).ok_or_else(|| format!("unknown provider: {provider}"))?;
    match entry.dialect {
        "openai-responses" => match route::resolve_openai_auth(app).await? {
            OpenaiAuth::Codex {
                access_token,
                account_id,
            } => {
                openai_codex::call_completion(
                    &access_token,
                    &account_id,
                    crate::app_identity::ORIGINATOR,
                    instructions,
                    user_text,
                    model,
                )
                .await
            }
            OpenaiAuth::ApiKey(key) => {
                openai_api_key::call_completion(&key, instructions, user_text, model).await
            }
        },
        "anthropic-messages" => {
            let auth = route::resolve_anthropic_auth(app).await?;
            anthropic::call_completion(&auth, instructions, user_text, model).await
        }
        "openai-chat-completions" => {
            let (base_url, api_key, default_model) =
                route::resolve_chat_completions(app, entry).await?;
            let model = model
                .map(str::to_string)
                .or(default_model)
                .ok_or_else(|| NOT_CONFIGURED.to_string())?;
            custom::call_completion(
                &base_url,
                api_key.as_deref(),
                &model,
                instructions,
                user_text,
            )
            .await
        }
        other => Err(format!("unhandled dialect: {other}")),
    }
}

/// Live model list for the agent model picker in Settings. "custom" isn't
/// handled here - it already has fetch_custom_models, which also lets the
/// frontend try before saving a config.
#[tauri::command]
pub async fn fetch_agent_models(app: AppHandle, provider: String) -> Result<Vec<String>, String> {
    let entry = catalog::find(&provider).ok_or_else(|| format!("unknown provider: {provider}"))?;
    if !entry.models_listable {
        return Err(format!(
            "{} doesn't support listing models - pick one from the preset list.",
            entry.label
        ));
    }
    match entry.dialect {
        "anthropic-messages" => {
            let auth = route::resolve_anthropic_auth(&app).await?;
            anthropic::list_models(&auth).await
        }
        // OAuth (Codex) tokens 403 on GET /v1/models ("Missing scopes:
        // api.model.read", a Console/API-key permission Codex tokens don't
        // have) - only the API-key path can list.
        "openai-responses" => {
            let key = crate::auth::keys::load_provider_key(&app, "openai")?
                .ok_or_else(|| NOT_CONFIGURED.to_string())?;
            custom::list_models("https://api.openai.com/v1", Some(&key)).await
        }
        "openai-chat-completions" if provider != "custom" => {
            let key = crate::auth::keys::load_provider_key(&app, &provider)?;
            custom::list_models(
                entry
                    .base_url
                    .expect("chat-completions catalog entries carry a base_url"),
                key.as_deref(),
            )
            .await
        }
        _ => Err(format!("models can't be listed for provider: {provider}")),
    }
}

/// Mirrors the frontend's proxy setting into aicompat's shared HTTP client.
/// Settings live in the frontend's localStorage, which Rust can't read (same
/// mirroring precedent as commands::prefs), so the frontend re-sends this on
/// startup and on every change. Rejects unparseable proxy URLs.
#[tauri::command]
pub fn set_ai_proxy(proxy: Option<String>) -> Result<(), String> {
    aicompat::http::set_proxy(proxy)
}

// The completion contract, end to end:
//   - context: the frontend sends the text around the CURSOR - up to the
//     last 2000 chars before it and the first 500 after (ghost-text-plugin's
//     MAX_CONTEXT_CHARS / MAX_AFTER_CONTEXT_CHARS), and only once there are
//     at least 20 words/CJK chars before the cursor. Cursor-anchored, not
//     document-anchored: completing mid-document must continue from the
//     cursor, not from wherever the document happens to end.
//   - where: CompletionHints adds the document title, the heading path to
//     the cursor and the block type, so a list item gets an item and a
//     section gets text about that section.
//   - length: one sentence for the as-you-type nudge; two to four sentences
//     when the writer explicitly triggers a continuation.
//   - the join: the model repeats the last word before the cursor and
//     fit_to_cursor cuts it off again (see there for why).
//
// The live eval (live_eval/completion_matrix.rs) found the two rules below
// that the earlier prompt lacked: models never start a reply with a space,
// so "it quickly" + "grew" landed as "quicklygrew" in every space-separated
// language; and "the next concrete detail" read as licence to invent
// figures and findings the writer never gave.
const COMPLETION_INSTRUCTIONS: &str = "You are the inline autocomplete of a markdown writing app. When the writer pauses, you propose the words they would most plausibly write next; they see it as grey text and accept it with Tab.

The input marks the insertion point: <text-before-cursor> ends exactly at the cursor and <text-after-cursor> starts exactly there (it may be empty). When present, <document-title>, <section> (the headings around the cursor, outermost first) and <block> (what the cursor is in) say where in the document this is.

Write ONLY the text to insert at the cursor:
- Continue from the exact last character. When <text-before-cursor> ends with a letter or digit, begin your output by repeating its last word exactly as typed - completed, if the cursor is in the middle of it - and continue from there; the repeated part is removed before the writer sees it, which is how a cut-off word gets finished and how the space after a finished word comes out right. When it ends with a space, punctuation or a character of a script written without spaces (Chinese, Japanese, Thai), repeat nothing and just continue.
- Move the text forward with what the text already supports: finish the thought, draw the consequence it sets up, give the next step or point it promises. Never invent facts the writer hasn't given - figures, names, dates, findings, quotes - and never restate, summarize or paraphrase what is already written. Skip generic filler and stock phrases (pivotal, crucial, delve, \"plays a vital role\", \"not just X but Y\", 至关重要, 不仅……更……) unless the writer already writes that way.
- Write as this writer writes: same language (including any mixing), register, person, tense, terminology and punctuation style, such as full-width punctuation in Chinese.
- Stay inside the block: in a list item write only that item's text, in a heading only the heading, in a table cell only the cell, in a code block only code in that language and indentation. Never add a line break (except inside code), list marker or markdown the surrounding text isn't already using.
- Where after-text exists, lead into it without repeating any of it.
- If nothing worthwhile can be added, return nothing.
No explanations, quotation marks or code fences.";

const COMPLETION_LENGTH_SHORT: &str = "Length: one sentence at most - roughly 8 to 25 words, or 10 to 40 characters of CJK text. Finishing the current sentence well beats starting a new one.";

const COMPLETION_LENGTH_LONG: &str = "Length: the writer explicitly asked for a continuation, so carry the current paragraph on by two to four sentences - roughly 40 to 90 words, or 60 to 160 characters of CJK text. Stay in this paragraph: no new paragraph, heading or list.";

/// What the frontend knows about the cursor beyond the raw text around it
/// (ghost-text-plugin.ts's completionHints). Mirrors CompletionHints in
/// src/ipc.ts.
#[derive(Deserialize, Default)]
pub struct CompletionHints {
    #[serde(default)]
    pub(crate) title: Option<String>,
    #[serde(default)]
    pub(crate) section: Vec<String>,
    #[serde(default)]
    pub(crate) block: Option<String>,
    #[serde(default)]
    pub(crate) length: Option<String>,
    /// How many alternative continuations to return (manual trigger only),
    /// separated by CANDIDATE_SEPARATOR lines.
    #[serde(default)]
    pub(crate) candidates: Option<u8>,
}

/// The line between alternative continuations in one response.
pub(crate) const CANDIDATE_SEPARATOR: &str = "<<<>>>";

/// The completion request's user turn: the optional where-am-I tags, then
/// the text split at the cursor. No whitespace between the cursor tags and
/// the text - the before-text must end exactly at the cursor for "continue
/// from the exact end" to mean anything.
fn completion_user_text(before: &str, after: &str, hints: &CompletionHints) -> String {
    let mut text = String::new();
    if let Some(title) = hints.title.as_deref().filter(|t| !t.trim().is_empty()) {
        text.push_str(&format!("<document-title>{title}</document-title>\n"));
    }
    if !hints.section.is_empty() {
        text.push_str(&format!(
            "<section>{}</section>\n",
            hints.section.join(" > ")
        ));
    }
    if let Some(block) = hints.block.as_deref().filter(|b| !b.trim().is_empty()) {
        text.push_str(&format!("<block>{block}</block>\n"));
    }
    text.push_str(&format!(
        "<text-before-cursor>{before}</text-before-cursor>\n<text-after-cursor>{after}</text-after-cursor>"
    ));
    text
}

#[tauri::command]
// Nine arguments at the IPC boundary, each a separate optional input from
// the frontend; bundling them would only move the same list into a struct.
#[allow(clippy::too_many_arguments)]
pub async fn ai_complete(
    app: AppHandle,
    provider: String,
    before: String,
    after: String,
    style: Option<String>,
    model: Option<String>,
    hints: Option<CompletionHints>,
    doc_path: Option<String>,
    workspace_root: Option<String>,
) -> Result<String, String> {
    let (mut instructions, user_text) = completion_prompt(
        &before,
        &after,
        &hints.unwrap_or_default(),
        style.as_deref(),
    );
    // The project's style profile and the library entries the surrounding
    // text mentions - the same writing context the agent gets, so a
    // continuation uses the right names and the author's voice.
    let workspace = cached_workspace(&app, doc_path, workspace_root);
    let mentioned =
        crate::ai::project::relevant_library(&workspace.library, &format!("{before}\n{after}"));
    if let Some(section) =
        crate::ai::project::writing_context_section(workspace.style.as_deref(), &mentioned)
    {
        instructions.push_str("\n\n");
        instructions.push_str(&section);
    }
    let raw = call(&app, &provider, instructions, user_text, model.as_deref()).await?;
    Ok(finish_completion(&before, &raw))
}

/// Scripts written without spaces between words: ideographs, kana and
/// full-width forms, and Thai, Lao, Tibetan, Myanmar and Khmer. Hangul is
/// not among them - Korean spaces its words.
fn is_unspaced_script(c: char) -> bool {
    matches!(c,
        '\u{0e00}'..='\u{109f}'
        | '\u{1780}'..='\u{17ff}'
        | '\u{2e80}'..='\u{9fff}'
        | '\u{f900}'..='\u{faff}'
        | '\u{ff00}'..='\u{ffef}'
        | '\u{20000}'..='\u{3134f}')
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() && !is_unspaced_script(c)
}

/// What holds letters together in one written word: "don't", "C'est",
/// "well-known", "3.5", "total_count".
const WORD_JOINERS: [char; 5] = ['\'', '\u{2019}', '-', '.', '_'];

/// What the model may repeat as the last word before the cursor, longest
/// first: the whole written word ("don't", "well-known", "3.5") and its
/// tails after a hyphen, dot or underscore ("known", "5"). Never the tail
/// after an apostrophe: nobody repeats the "t" of "don't", and matching it
/// would cut the "t" off a next word like "think".
fn repeatable_words(before: &str) -> Vec<&str> {
    let start = before
        .char_indices()
        .rev()
        .take_while(|&(_, c)| is_word_char(c) || WORD_JOINERS.contains(&c))
        .last()
        .map_or(before.len(), |(i, _)| i);
    let token = &before[start..];
    let mut words = Vec::new();
    let mut prev: Option<char> = None;
    for (i, c) in token.char_indices() {
        let starts_word = is_word_char(c) && !prev.is_some_and(is_word_char);
        let after_apostrophe = matches!(prev, Some('\'' | '\u{2019}')) && !words.is_empty();
        if starts_word && !after_apostrophe {
            words.push(&token[i..]);
        }
        prev = Some(c);
    }
    words
}

/// Joins one continuation onto the text before the cursor. The prompt has
/// the model repeat the last word when the before-text ends inside or right
/// after one: cutting that word off again leaves exactly the rest of a
/// cut-off word ("docu" + "document is" -> "ment is") or a space and the
/// next word ("quickly" + "quickly grew" -> " grew"). A model that skipped
/// the repeat gets the space a new word needs. Models never begin a reply
/// with a space on their own, which is why this can't be left to them.
pub(crate) fn fit_to_cursor(before: &str, text: &str) -> String {
    // Spaces the model led with are its guess at the join, which is made
    // here instead - except at the start of a line, where they are code
    // indentation.
    let text = if before.ends_with('\n') {
        text
    } else {
        text.trim_start_matches([' ', '\t'])
    };
    // The repeated word cut off again - all of the reply when the model
    // repeated it and had nothing to add.
    if let Some(rest) = repeatable_words(before)
        .into_iter()
        .find_map(|word| text.strip_prefix(word))
    {
        return rest.to_string();
    }
    let joins_words = before
        .chars()
        .last()
        .is_some_and(|c| is_word_char(c) || ".,;:!?)]}\"'”’…".contains(c))
        && text
            .chars()
            .next()
            .is_some_and(|c| is_word_char(c) || "(\"“'‘".contains(c));
    if joins_words {
        format!(" {text}")
    } else {
        text.to_string()
    }
}

/// The model's reply as the editor should get it: each candidate fitted to
/// the cursor, the separator lines kept for the frontend's splitCandidates.
/// A newline the first (or only) candidate opens with is its own - code
/// going on on the next line, whose indentation must survive - while after
/// a separator, newlines only end the separator's line: each later
/// candidate gets exactly one, so the frontend can split there and keep the
/// joining space that follows it.
pub(crate) fn finish_completion(before: &str, raw: &str) -> String {
    raw.split(CANDIDATE_SEPARATOR)
        .enumerate()
        .map(|(i, part)| {
            let (lead, part) = if i == 0 {
                ("", part)
            } else {
                ("\n", part.trim_start_matches('\n'))
            };
            let body = part.trim_end_matches('\n');
            if body.trim().is_empty() {
                format!("{lead}{part}")
            } else {
                let tail = &part[body.len()..];
                format!("{lead}{}{tail}", fit_to_cursor(before, body))
            }
        })
        .collect::<Vec<_>>()
        .join(CANDIDATE_SEPARATOR)
}

/// The workspace for a completion, re-read at most every few seconds:
/// completions fire on every typing pause, and the style profile and
/// library only change when the user edits those files. One entry - typing
/// happens in one document at a time.
fn cached_workspace(
    app: &AppHandle,
    doc_path: Option<String>,
    workspace_root: Option<String>,
) -> crate::ai::workspace::AgentWorkspace {
    use crate::ai::workspace::AgentWorkspace;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    type Key = (Option<String>, Option<String>);
    static CACHE: Mutex<Option<(Key, Instant, AgentWorkspace)>> = Mutex::new(None);
    let key = (doc_path, workspace_root);
    let mut cache = CACHE.lock().unwrap();
    if let Some((cached_key, at, ws)) = cache.as_ref() {
        if *cached_key == key && at.elapsed() < Duration::from_secs(10) {
            return ws.clone();
        }
    }
    let ws = crate::ai::workspace::load(app, key.0.as_deref(), key.1.as_deref());
    *cache = Some((key, Instant::now(), ws.clone()));
    ws
}

/// The completion request as (system instructions, user turn) - shared by
/// the command and the live eval (live_eval.rs), so what the eval measures
/// is exactly what the app sends.
pub(crate) fn completion_prompt(
    before: &str,
    after: &str,
    hints: &CompletionHints,
    style: Option<&str>,
) -> (String, String) {
    let user_text = completion_user_text(before, after, hints);
    let length = match hints.length.as_deref() {
        Some("long") => COMPLETION_LENGTH_LONG,
        _ => COMPLETION_LENGTH_SHORT,
    };
    // The user's tone/style preferences (from Settings) ride along after the
    // base contract so they can shape the wording without being able to
    // override the format and length rules above them.
    let mut instructions = match style.map(str::trim) {
        Some(style) if !style.is_empty() => format!(
            "{COMPLETION_INSTRUCTIONS}\n\n{length}\n\nStyle preferences from the user (follow them where they don't conflict with the rules above): {style}"
        ),
        _ => format!("{COMPLETION_INSTRUCTIONS}\n\n{length}"),
    };
    // One request for all alternatives: cheaper than N calls, and the model
    // can make them genuinely different rather than N near-copies.
    if let Some(n) = hints.candidates.filter(|n| *n > 1) {
        instructions.push_str(&format!(
            "\n\nWrite {n} alternative continuations that take the text in clearly different directions (different next point, angle or wording) - each one following every rule above. Output them one after another, separated by a line containing only {CANDIDATE_SEPARATOR}. Nothing else."
        ));
    }
    (instructions, user_text)
}

const GRAMMAR_INSTRUCTIONS: &str = "You are a grammar and clarity checker embedded in a markdown editor. You will be given a single paragraph of plain prose text (already stripped of markdown syntax - never expect or emit formatting markup). Respond with ONLY a JSON array (no markdown fences, no explanation, no surrounding text) of objects shaped like: [{\"start\": <0-indexed char offset, inclusive>, \"end\": <0-indexed char offset, exclusive>, \"original\": \"the exact text of that span, copied verbatim from the paragraph\", \"context\": \"the span plus a few words of surrounding paragraph text on each side, copied verbatim - REQUIRED whenever the span's text occurs more than once in the paragraph\", \"issue\": \"short description\", \"suggestion\": \"replacement text for that span\"}].\n\nRules for choosing a span: make it as small as possible - just the word or short phrase that is actually wrong, never the whole sentence or clause around it, and never a correct word next to the mistake. When the fix removes a word (a doubled \"the the\", a stray particle), include one neighbouring space in the span so that no double space is left behind. `suggestion` replaces `original` exactly in place, so it must fit grammatically both where `original` was cut off and where it resumes, and it must not repeat any surrounding text that is outside the span. Never let two reported spans overlap; if two issues touch overlapping text, report only the more important one.\n\nBe conservative: only report something you are genuinely confident is wrong, never a hallucinated issue or a preference disguised as a fix. Skip: proper nouns, names, and invented/brand words even if unfamiliar; direct quotations and deliberately non-standard phrasing (dialogue, dialect, emphasis); numbers, code-like tokens, and URLs. When a sentence is grammatically valid but could be phrased differently, only flag it under the scope rules given below - matching an ordinary reader's taste is not itself a reason to report something.\n\nOffsets must index into the exact paragraph text given, counting Unicode scalar values left to right. Write `issue` in the same language as the paragraph. If there are no issues, respond with exactly: []";

/// The scope limit appended per strictness level - what the check is allowed
/// to report. Unknown/absent values fall back to "standard". Spelled out
/// after the live eval caught the cheap default model reporting a verb
/// agreement fix as a "typo", missing 的/地 confusion at the standard level,
/// and finding something to say about a correct paragraph at "strict".
fn strictness_instructions(strictness: Option<&str>) -> &'static str {
    match strictness {
        Some("typos") => "Scope: report ONLY unambiguous typos you are certain about - misspelled words, wrong characters (including a character from the wrong script, such as a simplified character in traditional Chinese) and accidentally doubled words. Wrong verb forms, agreement, tense and word choice are grammar, not typos: do not report them at this level, however wrong they are. No phrasing or style.",
        Some("strict") => "Scope: report typos, grammar mistakes, and additionally redundancy, ambiguity and unclear phrasing worth tightening. A paragraph that is already clear and correct still gets [] - strict widens what counts as a problem, not how hard to look for one.",
        _ => "Scope: report typos and clear grammar mistakes - agreement, verb forms, wrong or missing particles and function words (such as Chinese 的/地/得), doubled or missing words. Do not report stylistic preferences or optional rephrasing.",
    }
}

#[derive(Deserialize, Serialize, Clone)]
pub struct GrammarIssue {
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) issue: String,
    pub(crate) suggestion: String,
    /// The span's exact text as the model saw it. Models routinely get char
    /// offsets wrong (especially in CJK text) while quoting the span itself
    /// correctly, so this is the ground truth offsets are checked against -
    /// and what the frontend re-verifies at apply time.
    #[serde(default)]
    pub(crate) original: Option<String>,
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
            let span: Option<String> =
                offsets_valid.then(|| chars[issue.start..issue.end].iter().collect());
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
    model: Option<String>,
) -> Result<Vec<GrammarIssue>, String> {
    let ask = || {
        call(
            &app,
            &provider,
            grammar_instructions(strictness.as_deref()),
            paragraph.clone(),
            model.as_deref(),
        )
    };
    // One retry on a malformed reply: the cheap default model occasionally
    // returns something that isn't the issue array (the live eval caught a
    // bare `[10, ...]`), and a second sample almost always parses.
    match parse_grammar_reply(&ask().await?, &paragraph) {
        Ok(issues) => Ok(issues),
        Err(_) => parse_grammar_reply(&ask().await?, &paragraph),
    }
}

/// The grammar check's system prompt for a strictness level - shared with
/// the live eval (live_eval.rs), like completion_prompt.
pub(crate) fn grammar_instructions(strictness: Option<&str>) -> String {
    format!(
        "{GRAMMAR_INSTRUCTIONS}\n\n{}",
        strictness_instructions(strictness)
    )
}

/// The model's reply as verified issues: the JSON array pulled out of it,
/// with every span checked against (and repaired from) the paragraph.
pub(crate) fn parse_grammar_reply(raw: &str, paragraph: &str) -> Result<Vec<GrammarIssue>, String> {
    let json_slice =
        extract_json_array(raw).ok_or_else(|| "no JSON array in model response".to_string())?;
    let issues: Vec<GrammarIssue> = serde_json::from_str(json_slice).map_err(|e| e.to_string())?;
    Ok(validate_issues(issues, paragraph))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completion_user_text_puts_hints_before_the_cursor_split() {
        let hints = CompletionHints {
            title: Some("Field notes".into()),
            section: vec!["Methods".into(), "Sampling".into()],
            block: Some("list item".into()),
            length: Some("short".into()),
            candidates: None,
        };
        let text = completion_user_text("We took", "", &hints);
        assert_eq!(
            text,
            "<document-title>Field notes</document-title>\n\
             <section>Methods > Sampling</section>\n\
             <block>list item</block>\n\
             <text-before-cursor>We took</text-before-cursor>\n\
             <text-after-cursor></text-after-cursor>"
        );
        // No hints: just the split, as before.
        assert_eq!(
            completion_user_text("a", "b", &CompletionHints::default()),
            "<text-before-cursor>a</text-before-cursor>\n<text-after-cursor>b</text-after-cursor>"
        );
    }

    #[test]
    fn completions_join_the_text_before_the_cursor() {
        // The repeated last word is cut off again: the rest of a cut-off
        // word, or a space and the next word.
        assert_eq!(
            fit_to_cursor("a full copy of the docu", "document grew"),
            "ment grew"
        );
        assert_eq!(
            fit_to_cursor("on long files it quickly", "quickly grew"),
            " grew"
        );
        assert_eq!(fit_to_cursor("직장인들이", "직장인들이 들른다"), " 들른다");
        // No repeat from the model: a new word gets its space.
        assert_eq!(fit_to_cursor("on long files it quickly", "grew"), " grew");
        assert_eq!(
            fit_to_cursor("doubled in six months.", "Le problème"),
            " Le problème"
        );
        assert_eq!(
            fit_to_cursor("Berufstätige", ", die abends"),
            ", die abends"
        );
        // A word with an apostrophe, hyphen or dot is repeated whole - and
        // without the repeat, the letters after an apostrophe never eat
        // the start of the next word.
        assert_eq!(fit_to_cursor("I don't", "don't think so"), " think so");
        assert_eq!(fit_to_cursor("I don't", "think so"), " think so");
        assert_eq!(fit_to_cursor("I don'", "don't know"), "t know");
        assert_eq!(fit_to_cursor("C'est", "C'est la vie"), " la vie");
        assert_eq!(fit_to_cursor("a well-known", "well-known fact"), " fact");
        assert_eq!(fit_to_cursor("a well-known", "known fact"), " fact");
        assert_eq!(fit_to_cursor("version 3.5", "3.5 adds"), " adds");
        // The repeat and nothing more: nothing to add.
        assert_eq!(fit_to_cursor("it quickly", "quickly"), "");
        // Unspaced scripts and spaces already typed: nothing added.
        assert_eq!(fit_to_cursor("规划者在制定方案时", "应当"), "应当");
        assert_eq!(fit_to_cursor("我们用", "React 重写"), "React 重写");
        assert_eq!(fit_to_cursor("ฉันชอบ", "กินข้าว"), "กินข้าว");
        assert_eq!(fit_to_cursor("thank you for ", "your note"), "your note");
        // Code indentation at the start of a line is kept.
        assert_eq!(
            fit_to_cursor("for s in xs:\n", "    total += s"),
            "    total += s"
        );
        assert_eq!(
            finish_completion("def f():", "\n    return 1"),
            "\n    return 1"
        );
        // Each candidate is fitted, and each later one starts on the line
        // after its separator, so its joining space survives the split.
        assert_eq!(
            finish_completion("it quickly", "quickly grew\n<<<>>>\nslowed"),
            " grew\n<<<>>>\n slowed"
        );
        assert_eq!(
            finish_completion("it quickly", "grew\n\n<<<>>>\n\nslowed\n<<<>>>\n"),
            " grew\n\n<<<>>>\n slowed\n<<<>>>\n"
        );
    }

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
