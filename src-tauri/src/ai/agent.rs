use crate::ai::cancel;
use crate::ai::catalog;
use crate::ai::route::{self, OpenaiAuth, NOT_CONFIGURED};
use crate::ai::tools::{self, ToolContext};
use crate::ai::workspace::{self, AgentWorkspace};
use aicompat::agent::{run_agent_loop, AgentTurn};
use aicompat::providers::{
    anthropic, custom, openai_api_key, openai_codex, openai_responses_compatible,
};
use std::path::Path;
use tauri::AppHandle;

/// Skill loads, file reads, and web searches all consume steps, so a
/// research-y request needs more headroom than the old chat-only loop did.
const MAX_STEPS: usize = 12;

/// Alibaba exposes web search for newer Qwen generations through its
/// OpenAI-compatible Responses API; older qwen-plus/flash models keep the
/// Chat Completions `enable_search` switch.
fn qwen_uses_responses_search(model: &str) -> bool {
    ["qwen3.7-", "qwen3.6-", "qwen3.5-", "qwen3-max"]
        .iter()
        .any(|prefix| model.starts_with(prefix))
}

const AGENT_ROLE: &str = "You are a professional writing assistant embedded in Levis, a markdown editor. You help the user plan, draft, revise, and polish their writing: outlining, continuing a draft, rewriting for tone or clarity, critiquing structure and argument, checking facts, and answering questions about the document they have open (included below). Reply in the same language the user writes in. Be concise and concrete - when giving feedback, point at specific passages instead of generalities. Write any math formula with `$...$` for inline and `$$...$$` on its own line for block - never `\\(...\\)` or `\\[...\\]`, which this editor does not render.";

/// Only appended for providers that actually run the tool loop; telling a
/// tool-less provider to call tools would just confuse it.
const AGENT_TOOL_INSTRUCTIONS: &str = "Use the search_document tool to locate something specific in a long document rather than guessing. The document's folder may hold reference material - use list_files/read_file to consult it when the user's request depends on it. If what the user is asking for ends up as document content - a rewrite, a continuation, a new paragraph, section, list, or anything else meant to land in the document rather than just be talked about - it MUST go through propose_edit (once per distinct edit), never written out only in your chat reply. This applies just as much to brand-new content you are drafting (use append/insert_before/insert_after) as it does to editing something that is already there - 'continuing the draft' still means proposing the continuation, not narrating it. A plain-text reply is for discussion, feedback, or answering questions about the document - never for delivering content the user asked you to add or change. Pick the action that matches the intent: replace to swap existing text, replace_selection to swap the user's selected text (when their message carries a <selected-text> block and asks to rewrite/modify it - no anchor needed), insert_before/insert_after to add text next to existing text, delete to remove text, append to add text at the end of the document. The document you are shown is MARKDOWN SOURCE, and both fields work in that same markdown. `anchor` must be copied verbatim out of it - including any markdown syntax it contains, so a bold phrase is quoted as `**like this**`, a heading as `## Like This` - and must occur exactly once. `text` replaces it and must also be valid markdown: carry over whatever formatting the original had unless the user asked you to change it, and use `-` or `1.` for list items (never `•`, `●` or other bullet symbols) and `#` for headings. Dropping a heading's `#`, a list item's `-`, or a phrase's `**` silently destroys that formatting in the user's document. The user reviews and applies each proposal themselves, so your reply should only say briefly what you changed and why.";

/// Above this, the document is embedded in full; past it, the prompt gets
/// an outline plus a head/tail excerpt instead - every chat message used to
/// re-send the whole document verbatim, which got slow and expensive for
/// long files. Tool-enabled dialects lose nothing by this: `search_document`
/// (tools.rs) always searches the full text, independent of what's embedded
/// here, so the model can still look up anything not shown.
const FULL_DOCUMENT_LIMIT: usize = 16_000;
const EXCERPT_CHARS: usize = 1_500;
const MAX_OUTLINE_HEADINGS: usize = 80;

/// Markdown heading lines (`#` through `######`, e.g. not a `#tag`-style
/// line with no space) - a quick outline for when the model can't see the
/// document's middle.
fn heading_outline(document: &str) -> Vec<&str> {
    document
        .lines()
        .filter(|line| {
            let trimmed = line.trim_start();
            let hashes = trimmed.chars().take_while(|&c| c == '#').count();
            (1..=6).contains(&hashes) && trimmed.as_bytes().get(hashes) == Some(&b' ')
        })
        .take(MAX_OUTLINE_HEADINGS)
        .collect()
}

/// Char-count (not byte) prefix/suffix - document content is arbitrary
/// UTF-8 (CJK text especially), so a naive byte slice could land mid-char.
fn char_prefix(s: &str, n: usize) -> &str {
    s.char_indices().nth(n).map_or(s, |(i, _)| &s[..i])
}

fn char_suffix(s: &str, n: usize) -> &str {
    let total = s.chars().count();
    if total <= n {
        return s;
    }
    s.char_indices().nth(total - n).map_or(s, |(i, _)| &s[i..])
}

/// The `---document---` prompt section: the full text under
/// `FULL_DOCUMENT_LIMIT`, otherwise an outline plus start/end excerpts.
fn document_section(document: &str, with_tools: bool) -> String {
    let len = document.chars().count();
    if len <= FULL_DOCUMENT_LIMIT {
        return format!("---document---\n{document}");
    }
    let outline = heading_outline(document);
    let outline_block = if outline.is_empty() {
        "(no headings)".to_string()
    } else {
        outline.join("\n")
    };
    let note = if with_tools {
        "This document is long, so only an outline and the start/end are shown below - use the search_document tool to look up anything else in it."
    } else {
        "This document is long, so only an outline and the start/end are shown below - some content in the middle isn't visible here."
    };
    format!(
        "---document (truncated, {len} chars total)---\n{note}\n\n[outline]\n{outline_block}\n\n[start]\n{}\n\n[end]\n{}",
        char_prefix(document, EXCERPT_CHARS),
        char_suffix(document, EXCERPT_CHARS),
    )
}

/// The static half of the layering: role + workspace instructions + skill
/// index + document go into the system prompt; skill bodies and workspace
/// files stay out of it and are pulled in dynamically through tools.
fn build_instructions(workspace: &AgentWorkspace, document: &str, with_tools: bool) -> String {
    let mut sections = vec![AGENT_ROLE.to_string()];

    if with_tools {
        sections.push(AGENT_TOOL_INSTRUCTIONS.to_string());
    }

    // agent.md layers (global, then the document folder's) - the user's own
    // standing instructions: style, terminology, project background.
    for instructions in &workspace.instructions {
        sections.push(format!("---user instructions---\n{instructions}"));
    }

    // The skill index: names + descriptions only. Bodies load on demand via
    // use_skill, so a large skill library costs almost nothing per request.
    if with_tools && !workspace.skills.is_empty() {
        let index: Vec<String> = workspace
            .skills
            .iter()
            .map(|s| format!("- {}: {}", s.name, s.description))
            .collect();
        sections.push(format!(
            "---available skills---\n{}\nWhen a request matches a skill's description, load it with use_skill and follow it.",
            index.join("\n")
        ));
    }

    sections.push(document_section(document, with_tools));
    sections.join("\n\n")
}

/// Sends one user message and runs the conversation forward, returning the
/// new turns produced (the user's own turn, any tool calls/results, and the
/// final assistant reply) for the frontend to append to its history.
///
/// Tool calling runs for every dialect with an `agent_step` implemented in
/// `aicompat::providers`: openai-responses, anthropic-messages, and
/// openai-chat-completions (the generic dialect most self-hosted/proxy
/// servers speak - OpenRouter, Groq, Ollama, and friends, plus "custom").
/// The chat-completions dialect additionally falls back to
/// `flattened_chat_turn` on a hard failure, since not every compatible
/// server actually implements `tools` correctly. A provider with no dialect
/// at all falls straight to `flattened_chat_turn`, a single non-agentic
/// completion (with the workspace's agent.md layers still in the system
/// prompt; skills reach them via the frontend's /name injection instead of
/// use_skill). The orchestration loop (`run_agent_loop`) and the tool
/// implementations (`crate::ai::tools`) don't know which dialect is in play -
/// adding tool-calling support for another provider is just wiring up its
/// own `step` closure in the matching dialect arm below.
/// `model` is the user's Settings choice, or None for the provider default.
// Each parameter is a distinct invoke() payload key - bundling them into a
// struct would only move the width into the frontend call site.
/// Thin wrapper around `ai_agent_message_inner` that races it against a
/// cancellation signal (the chat "stop" button - see `ai::cancel`).
/// `request_id` is frontend-generated and only meaningful for the duration
/// of this one call, so it's registered and torn down here rather than
/// threaded into the dialect-specific logic below.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn ai_agent_message(
    app: AppHandle,
    provider: String,
    document: String,
    doc_path: Option<String>,
    history: Vec<AgentTurn>,
    message: String,
    web_search: bool,
    model: Option<String>,
    request_id: String,
) -> Result<Vec<AgentTurn>, String> {
    let cancel_rx = cancel::register(request_id.clone());
    let result = tokio::select! {
        result = ai_agent_message_inner(app, provider, document, doc_path, history, message, web_search, model) => result,
        _ = cancel_rx => Err(cancel::CANCELLED.to_string()),
    };
    cancel::unregister(&request_id);
    result
}

#[allow(clippy::too_many_arguments)]
async fn ai_agent_message_inner(
    app: AppHandle,
    provider: String,
    document: String,
    doc_path: Option<String>,
    history: Vec<AgentTurn>,
    message: String,
    web_search: bool,
    model: Option<String>,
) -> Result<Vec<AgentTurn>, String> {
    let workspace = workspace::load(&app, doc_path.as_deref());
    let entry = catalog::find(&provider).ok_or_else(|| format!("unknown provider: {provider}"))?;

    match entry.dialect {
        "openai-responses" => {
            let instructions = build_instructions(&workspace, &document, true);
            let tools =
                tools::builtin_tools(!workspace.skills.is_empty(), workspace.root.is_some());
            let tool_specs = tools::tool_specs(&tools);
            let tool_ctx = ToolContext {
                document: &document,
                skills: &workspace.skills,
                root: workspace.root.as_deref().map(Path::new),
            };

            match route::resolve_openai_auth(&app).await? {
                OpenaiAuth::Codex {
                    access_token,
                    account_id,
                } => {
                    let agent_model = model.unwrap_or_else(|| {
                        entry
                            .agent_default_model
                            .unwrap_or(openai_codex::COMPLETION_MODEL)
                            .to_string()
                    });
                    let step = |turns: Vec<AgentTurn>| {
                        let instructions = instructions.clone();
                        let tool_specs = tool_specs.clone();
                        let access_token = access_token.clone();
                        let account_id = account_id.clone();
                        let agent_model = agent_model.clone();
                        async move {
                            openai_codex::agent_step(
                                &access_token,
                                &account_id,
                                crate::app_identity::ORIGINATOR,
                                &instructions,
                                &turns,
                                &tool_specs,
                                web_search,
                                &agent_model,
                            )
                            .await
                        }
                    };
                    run_agent_loop(history, message, MAX_STEPS, step, |name, arguments| {
                        tools::execute(&tools, &tool_ctx, name, arguments)
                    })
                    .await
                }
                OpenaiAuth::ApiKey(api_key) => {
                    let agent_model = model.unwrap_or_else(|| {
                        entry
                            .agent_default_model
                            .unwrap_or(openai_api_key::PUBLIC_API_MODEL)
                            .to_string()
                    });
                    let step = |turns: Vec<AgentTurn>| {
                        let instructions = instructions.clone();
                        let tool_specs = tool_specs.clone();
                        let api_key = api_key.clone();
                        let agent_model = agent_model.clone();
                        async move {
                            openai_api_key::agent_step(
                                &api_key,
                                &instructions,
                                &turns,
                                &tool_specs,
                                web_search,
                                &agent_model,
                            )
                            .await
                        }
                    };
                    run_agent_loop(history, message, MAX_STEPS, step, |name, arguments| {
                        tools::execute(&tools, &tool_ctx, name, arguments)
                    })
                    .await
                }
            }
        }
        "anthropic-messages" => {
            let instructions = build_instructions(&workspace, &document, true);
            let auth = route::resolve_anthropic_auth(&app).await?;
            let tools =
                tools::builtin_tools(!workspace.skills.is_empty(), workspace.root.is_some());
            let tool_specs = tools::tool_specs(&tools);
            let tool_ctx = ToolContext {
                document: &document,
                skills: &workspace.skills,
                root: workspace.root.as_deref().map(Path::new),
            };

            let agent_model = model.unwrap_or_else(|| {
                entry
                    .agent_default_model
                    .unwrap_or(anthropic::COMPLETION_MODEL)
                    .to_string()
            });
            let step = |turns: Vec<AgentTurn>| {
                let instructions = instructions.clone();
                let tool_specs = tool_specs.clone();
                let auth = auth.clone();
                let agent_model = agent_model.clone();
                async move {
                    anthropic::agent_step(
                        &auth,
                        &instructions,
                        &turns,
                        &tool_specs,
                        web_search,
                        &agent_model,
                    )
                    .await
                }
            };

            run_agent_loop(history, message, MAX_STEPS, step, |name, arguments| {
                tools::execute(&tools, &tool_ctx, name, arguments)
            })
            .await
        }
        "openai-chat-completions" => {
            let (base_url, api_key, default_model) =
                route::resolve_chat_completions(&app, entry).await?;
            let endpoint_model = model
                .or_else(|| entry.agent_default_model.map(str::to_string))
                .or(default_model)
                .ok_or_else(|| NOT_CONFIGURED.to_string())?;
            let tools =
                tools::builtin_tools(!workspace.skills.is_empty(), workspace.root.is_some());
            let tool_specs = tools::tool_specs(&tools);
            let tool_ctx = ToolContext {
                document: &document,
                skills: &workspace.skills,
                root: workspace.root.as_deref().map(Path::new),
            };
            let instructions_with_tools = build_instructions(&workspace, &document, true);

            // These providers expose server-side search through their
            // current Chat Completions compatibility layer. Other providers
            // simply receive the normal local function tools.
            let native_web_search = if web_search {
                match provider.as_str() {
                    "groq" => Some(custom::NativeWebSearch::Groq),
                    "openrouter" => Some(custom::NativeWebSearch::OpenRouter),
                    "qwen" if !qwen_uses_responses_search(&endpoint_model) => {
                        Some(custom::NativeWebSearch::Qwen)
                    }
                    "zhipu" => Some(custom::NativeWebSearch::Zhipu),
                    _ => None,
                }
            } else {
                None
            };
            let use_responses_web_search = web_search
                && (provider == "xai"
                    || (provider == "qwen" && qwen_uses_responses_search(&endpoint_model)));

            let step = |turns: Vec<AgentTurn>| {
                let base_url = base_url.clone();
                let api_key = api_key.clone();
                let endpoint_model = endpoint_model.clone();
                let instructions = instructions_with_tools.clone();
                let tool_specs = tool_specs.clone();
                async move {
                    if use_responses_web_search {
                        return openai_responses_compatible::agent_step(
                            &base_url,
                            api_key.as_deref(),
                            &endpoint_model,
                            &instructions,
                            &turns,
                            &tool_specs,
                            true,
                        )
                        .await;
                    }
                    custom::agent_step(
                        &base_url,
                        api_key.as_deref(),
                        &endpoint_model,
                        &instructions,
                        &turns,
                        &tool_specs,
                        native_web_search,
                    )
                    .await
                }
            };

            // Not every OpenAI-compatible server implements `tools`
            // correctly (some 400 on it, some silently ignore it and never
            // call one) - a hard failure on the first step falls back to a
            // single tool-less completion instead of failing the request
            // outright. `history`/`message` are cloned so the fallback still
            // has them; `run_agent_loop` would otherwise have consumed them.
            match run_agent_loop(
                history.clone(),
                message.clone(),
                MAX_STEPS,
                step,
                |name, arguments| tools::execute(&tools, &tool_ctx, name, arguments),
            )
            .await
            {
                Ok(turns) => Ok(turns),
                Err(_) => {
                    let instructions = build_instructions(&workspace, &document, false);
                    flattened_chat_turn(
                        &app,
                        &provider,
                        &instructions,
                        history,
                        message,
                        Some(&endpoint_model),
                    )
                    .await
                }
            }
        }
        _ => {
            let instructions = build_instructions(&workspace, &document, false);
            flattened_chat_turn(
                &app,
                &provider,
                &instructions,
                history,
                message,
                model.as_deref(),
            )
            .await
        }
    }
}

/// Providers without tool-calling support get the conversation flattened
/// into a single plain-text turn and answered with one non-agentic
/// completion call.
async fn flattened_chat_turn(
    app: &AppHandle,
    provider: &str,
    instructions: &str,
    history: Vec<AgentTurn>,
    message: String,
    model: Option<&str>,
) -> Result<Vec<AgentTurn>, String> {
    fn turn_to_plain_text(turn: &AgentTurn) -> Option<String> {
        match turn {
            AgentTurn::User { text } => Some(format!("User: {text}")),
            AgentTurn::Assistant { text } => Some(format!("Assistant: {text}")),
            _ => None,
        }
    }

    let user_turn = AgentTurn::User { text: message };
    let mut transcript: Vec<String> = history.iter().filter_map(turn_to_plain_text).collect();
    if let Some(t) = turn_to_plain_text(&user_turn) {
        transcript.push(t);
    }

    let text = crate::ai::client::call(
        app,
        provider,
        instructions.to_string(),
        transcript.join("\n\n"),
        model,
    )
    .await?;
    Ok(vec![user_turn, AgentTurn::Assistant { text }])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qwen_search_endpoint_tracks_model_generation() {
        assert!(qwen_uses_responses_search("qwen3.7-plus"));
        assert!(qwen_uses_responses_search("qwen3.5-flash"));
        assert!(qwen_uses_responses_search("qwen3-max"));
        assert!(!qwen_uses_responses_search("qwen-plus"));
        assert!(!qwen_uses_responses_search("qwen-flash"));
    }

    #[test]
    fn short_document_is_embedded_verbatim() {
        let doc = "# Title\n\nJust a short document.";
        let section = document_section(doc, true);
        assert_eq!(section, format!("---document---\n{doc}"));
    }

    #[test]
    fn long_document_is_truncated_with_outline_and_excerpts() {
        let middle = "x".repeat(FULL_DOCUMENT_LIMIT + 1000);
        let doc = format!("# Start\n\nfirst-marker {middle} last-marker\n\n## End");
        let section = document_section(&doc, true);
        assert!(section.contains("truncated"));
        assert!(section.contains("# Start"));
        assert!(section.contains("## End"));
        assert!(section.contains("search_document"));
        assert!(section.contains("first-marker"));
        assert!(section.contains("last-marker"));
        // The bulk of the middle shouldn't appear - only outline + excerpts.
        assert!(section.len() < doc.len() / 2);
    }

    #[test]
    fn truncation_note_omits_tool_mention_without_tools() {
        let doc = "x".repeat(FULL_DOCUMENT_LIMIT + 1);
        let section = document_section(&doc, false);
        assert!(!section.contains("search_document"));
    }

    #[test]
    fn excerpts_are_char_boundary_safe_for_cjk() {
        // Every char here is multi-byte - a byte-index slice at a fixed
        // offset would panic mid-character.
        let doc = "中".repeat(FULL_DOCUMENT_LIMIT + 500);
        let section = document_section(&doc, true);
        assert!(section.contains('中'));
    }
}
