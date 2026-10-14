use crate::ai::cancel;
use crate::ai::catalog;
use crate::ai::route::{self, OpenaiAuth, NOT_CONFIGURED};
use crate::ai::tools::{self, ToolContext};
use crate::ai::workspace::{self, AgentWorkspace};
use aicompat::agent::{run_agent_loop, AgentTurn, ImageAttachment, ProviderEvent};
use aicompat::providers::{
    anthropic, custom, openai_api_key, openai_codex, openai_responses_compatible,
};
use serde::Serialize;
use std::path::Path;
use tauri::ipc::Channel;
use tauri::AppHandle;

/// One live fragment of an in-flight `ai_agent_message`, pushed to the
/// invoking window over a Tauri channel while the agent loop runs. Purely
/// additive display data: the command still resolves with the complete turn
/// list, which remains the authoritative result the frontend appends to its
/// history - a dropped or ignored event costs liveness, never correctness.
/// Mirrored by `StreamEvent` in src/ipc.ts - the two must stay in sync.
#[derive(Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum StreamEvent {
    /// A chunk of the assistant's prose for the turn being generated.
    Delta { text: String },
    /// The model opened a tool call; its arguments follow as ToolArgsDelta.
    ToolStart { call_id: String, name: String },
    /// A raw fragment of a tool call's JSON `arguments` string.
    ToolArgsDelta { call_id: String, delta: String },
    /// A completed intermediate turn (ToolCall/ToolResult) as it lands.
    Turn { turn: AgentTurn },
}

/// Forwards a provider-level fragment onto the frontend channel. Send
/// failures are ignored deliberately - a closed webview mid-request must
/// not fail the agent loop, which still returns turns for the history.
fn forward(channel: &Channel<StreamEvent>, event: ProviderEvent<'_>) {
    let event = match event {
        ProviderEvent::Text(text) => StreamEvent::Delta {
            text: text.to_string(),
        },
        ProviderEvent::ToolStart { call_id, name } => StreamEvent::ToolStart {
            call_id: call_id.to_string(),
            name: name.to_string(),
        },
        ProviderEvent::ToolArgs { call_id, delta } => StreamEvent::ToolArgsDelta {
            call_id: call_id.to_string(),
            delta: delta.to_string(),
        },
    };
    let _ = channel.send(event);
}

/// Skill loads, file reads, and web searches all consume steps, so a
/// research-y request needs more headroom than the old chat-only loop did.
pub(crate) const MAX_STEPS: usize = 12;

/// Alibaba exposes web search for newer Qwen generations through its
/// OpenAI-compatible Responses API; older qwen-plus/flash models keep the
/// Chat Completions `enable_search` switch.
fn qwen_uses_responses_search(model: &str) -> bool {
    ["qwen3.8-", "qwen3.7-", "qwen3.6-", "qwen3.5-", "qwen3-max"]
        .iter()
        .any(|prefix| model.starts_with(prefix))
}

/// The reply-language, invented-facts and shortening rules are from the live
/// eval (docs/AI-EVAL.md): replies followed the document's language instead
/// of the user's, expansions made up specifics, and tightened paragraphs
/// quietly lost facts while the reply said they were all kept.
const AGENT_ROLE: &str = "You are a professional writing assistant embedded in Levis, a markdown editor. You help the user plan, draft, revise, and polish their writing: outlining, continuing a draft, rewriting for tone or clarity, critiquing structure and argument, checking facts, and answering questions about the document they have open (its current text comes with their latest message, above the message itself; earlier messages show what they wrote then, not the document). Reply in the language of the user's own message - what they typed under ---the user's message--- - not the language of the document, and not the target language of a translation they asked for (asked in English to translate a paragraph into Spanish, you put Spanish in the document and reply in English); text you write into the document stays in the document's language unless they ask for another. A reply language set under ---user instructions--- overrides this. Be concise and concrete - when giving feedback, point at specific passages instead of generalities. When you write or revise text for the document, keep the author's voice, terminology and formatting conventions, change only what the request calls for, and leave everything else exactly as it was. Never add facts the author hasn't given - names, numbers, dates, causes, outcomes, plans, sensory details: expanding text or making it vivid means sharper wording and the consequences that follow from what is already there, not new information. If a request truly needs facts you don't have, say what is missing (or leave a clearly marked placeholder) instead of making them up; in fiction, invented detail is fine when it is asked for, as long as it stays consistent with the text and the project's library. When shortening, cut words, not information - every fact, figure, time span and named thing survives. Describe your changes accurately in your reply; never claim something was kept when it wasn't. Avoid the tics that make text read as machine-written unless the author's own text uses them: inflated significance (pivotal, testament, crucial, underscore, delve, tapestry, landscape), \"serves as\" where \"is\" will do, \"not just X but Y\", reflexive lists of three, closing a sentence with a participle clause about its importance, and liberal em dashes or bold. Plain, specific wording beats impressive wording. Write any math formula with `$...$` for inline and `$$...$$` on its own line for block - never `\\(...\\)` or `\\[...\\]`, which this editor does not render.";

/// Only appended for providers that actually run the tool loop; telling a
/// tool-less provider to call tools would just confuse it.
const AGENT_TOOL_INSTRUCTIONS: &str = "Use search_document to locate something specific in a long document, and read_document to see a whole section before you revise it - never guess at text you haven't seen. The document's folder may hold reference material - use list_files/read_file to consult it when the user's request depends on it. Read first, propose after: never send a propose_edit in the same step as the read it depends on. If what the user is asking for ends up as document content - a rewrite, a continuation, a new paragraph, section, list, or anything else meant to land in the document rather than just be talked about - it MUST go through propose_edit (once per distinct edit), never written out only in your chat reply. This applies just as much to brand-new content you are drafting (use append/insert_before/insert_after) as it does to editing something that is already there - 'continuing the draft' still means proposing the continuation, not narrating it. A plain-text reply is for discussion, feedback, or answering questions about the document - never for delivering content the user asked you to add or change. Pick the action that matches the intent: replace to swap existing text, replace_selection to swap the user's selected text (when their message carries a <selected-text> block and asks to rewrite/modify it - no anchor needed), insert_before/insert_after to add text next to existing text, insert_at_cursor to add text where the user's cursor is (when their message carries a <cursor> block marking it - for \"write a transition here\"), delete to remove text, append to add text at the end of the document. To add a table row or a list item, insert_after the whole neighbouring row or item line with just the new line(s) as `text`, a nested item keeping its indentation. Each proposal must target its own passage - for several changes inside one passage, send a single replace covering it, since overlapping proposals can't all be applied. The document you are shown is MARKDOWN SOURCE, and both fields work in that same markdown. `anchor` must be copied verbatim out of it - including any markdown syntax it contains, so a bold phrase is quoted as `**like this**`, a heading as `## Like This` - and must occur exactly once. When the text you need to target appears MORE than once in the document, keep `anchor` as the exact text being edited and additionally pass `context`: a longer quote copied verbatim from the document that contains the anchor and itself occurs exactly once - the edit lands on the anchor inside that context. `text` replaces it and must also be valid markdown: carry over whatever formatting the original had unless the user asked you to change it, and use `-` or `1.` for list items (never `•`, `●` or other bullet symbols) and `#` for headings. Dropping a heading's `#`, a list item's `-`, or a phrase's `**` silently destroys that formatting in the user's document. The user reviews and applies each proposal themselves, so your reply should only say briefly what you changed and why. In later requests, each earlier propose_edit tool result carries a bracketed status note saying what the user did with that proposal - accepted, rejected, or still undecided. Trust the note over any assumption: the document you are shown contains ONLY accepted edits, so an undecided or rejected proposal's text is not in it and must not be anchored to. Proposing new edits automatically replaces any still-undecided proposals in the editor, so never re-propose or try to retract an undecided one yourself. Judging which mode applies: an imperative instruction (rewrite, expand, shorten, translate, fix, delete, continue, add a section - in any language, phrased as a command rather than a question) is always propose_edit, even a short one like 'make this more concise' or 'continue'. A question, request for feedback, or discussion prompt (what do you think, why did I write this, is this clear, explain X) is always a plain-text reply with no propose_edit call, unless it explicitly also asks for a change - for feedback on specific passages, pin each point to its passage with add_comment and keep the reply to a short summary. A request for information about the document - summarize it, list its dates, explain a passage, count something - is answered in the reply even when it is phrased as a command, unless the user asks for the result to go into the document ('add a summary at the top'). When a message is genuinely ambiguous between changing the document and talking about it, prefer treating it as an edit instruction - most requests here are commands to act on the document, not questions about it.";

const AGENT_READ_ONLY_TOOL_INSTRUCTIONS: &str = "Use search_document to locate specific passages in a long document and read_document to read a section in full, rather than guessing. The document's folder may hold reference material - use list_files/read_file when the request depends on it. Use use_skill when an available skill matches. These tools are for inspection and research only; no document edit tool is available in this mode. For feedback on specific passages, pin each point with add_comment.";

/// Up to this many characters the document is embedded in full; past it,
/// the prompt gets a line-numbered outline plus a head/tail excerpt, and the
/// model reads what it needs through read_document / search_document
/// (tools.rs), which always work on the full text. Raised from 16k: that
/// cut ordinary chapters down to 3k characters of visible text, and the
/// Anthropic path now caches the prompt across tool steps.
const FULL_DOCUMENT_LIMIT: usize = 40_000;
const EXCERPT_CHARS: usize = 2_000;
const MAX_OUTLINE_HEADINGS: usize = 120;

/// The document's headings with the line each starts on (`L12 ## Methods`)
/// - the map read_document's line ranges and section names refer to.
fn heading_outline(document: &str) -> Vec<String> {
    let lines: Vec<&str> = document.lines().collect();
    crate::ai::tools::heading_lines(&lines)
        .into_iter()
        .take(MAX_OUTLINE_HEADINGS)
        .map(|(i, _)| format!("L{} {}", i + 1, lines[i].trim()))
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
/// Most of a focus section embedded alongside a truncated document.
const FOCUS_SECTION_CHARS: usize = 12_000;

/// The section headed `heading` (to the next heading at its level or above)
/// and the line it starts on - the part of a long document the user is
/// working in, which the truncated view would otherwise leave out.
fn focus_section(document: &str, heading: &str) -> Option<(usize, String)> {
    let lines: Vec<&str> = document.lines().collect();
    let (first, last) = crate::ai::tools::section_range(&lines, heading)?;
    let text = lines[first..last].join("\n");
    Some((
        first + 1,
        char_prefix(&text, FOCUS_SECTION_CHARS).to_string(),
    ))
}

fn document_section(document: &str, with_tools: bool, focus_heading: Option<&str>) -> String {
    let len = document.chars().count();
    if len <= FULL_DOCUMENT_LIMIT {
        return format!("---document---\n{document}");
    }
    let focus = focus_heading
        .and_then(|h| focus_section(document, h))
        .map(|(line, text)| {
            format!("\n\n[the section the user is working in, from line {line}]\n{text}")
        })
        .unwrap_or_default();
    let outline = heading_outline(document);
    let outline_block = if outline.is_empty() {
        "(no headings)".to_string()
    } else {
        outline.join("\n")
    };
    let note = if with_tools {
        "This document is long, so only an outline (with line numbers) and the start/end are shown below. Read any section in full with read_document (by heading or line range) before revising or quoting it, and use search_document to find where something is mentioned."
    } else {
        "This document is long, so only an outline and the start/end are shown below - some content in the middle isn't visible here."
    };
    format!(
        "---document (truncated, {len} chars, {} lines total)---\n{note}\n\n[outline]\n{outline_block}{focus}\n\n[start]\n{}\n\n[end]\n{}",
        document.lines().count(),
        char_prefix(document, EXCERPT_CHARS),
        char_suffix(document, EXCERPT_CHARS),
    )
}

/// The static half of the layering: role + workspace instructions + skill
/// index + document go into the system prompt; skill bodies and workspace
/// files stay out of it and are pulled in dynamically through tools.
pub(crate) fn build_instructions(
    workspace: &AgentWorkspace,
    document: &str,
    with_tools: bool,
    mode: &str,
    // What the request is about (the user's message) - library entries are
    // picked by what it and the document mention.
    focus: &str,
) -> String {
    let mut sections = vec![AGENT_ROLE.to_string()];

    sections.push(match mode {
        "edit" => "---interaction mode: edit---\nCarry out the user's request. When document changes are needed, submit them through propose_edit so the user can review them before applying.".to_string(),
        "plan" => "---interaction mode: plan---\nProduce a concrete, structured writing plan only - an outline, a revision plan, or the steps to get the document where the user wants it. You may research and inspect context, but do not call propose_edit and do not modify the document. Wait for the user to approve the plan in a later request.".to_string(),
        _ => "---interaction mode: ask---\nAnswer, explain, discuss, or research in read-only mode. Do not call propose_edit and do not modify the document.".to_string(),
    });

    if with_tools {
        sections.push(
            if mode == "edit" {
                AGENT_TOOL_INSTRUCTIONS
            } else {
                AGENT_READ_ONLY_TOOL_INSTRUCTIONS
            }
            .to_string(),
        );
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

    // Tool-calling paths carry the document (and the writing context picked
    // by it) in the user's latest message instead - see request_context -
    // so this prompt stays byte-identical across a conversation and the
    // provider's prompt cache survives every accepted edit. The tool-less
    // fallback keeps it here: it sends one flattened turn anyway.
    if !with_tools {
        sections.push(request_context(workspace, document, false, focus, None));
    }
    sections.join("\n\n")
}

/// The per-request context: the project's style profile and the library
/// entries this request touches, then the document (in full, or outlined
/// when long). Prepended to the CURRENT user message only, for the request;
/// what history keeps is the plain message (see ai_agent_message_inner), so
/// earlier turns never repeat an old copy of the document.
pub(crate) fn request_context(
    workspace: &AgentWorkspace,
    document: &str,
    with_tools: bool,
    focus: &str,
    // The heading of the section the cursor or selection is in, from the
    // editor - included in full when the document is too long to embed.
    focus_heading: Option<&str>,
) -> String {
    let document_text = document_section(document, with_tools, focus_heading);
    let mentioned = crate::ai::project::relevant_library(
        &workspace.library,
        &format!("{focus}\n{document_text}"),
    );
    let mut parts: Vec<String> =
        crate::ai::project::writing_context_section(workspace.style.as_deref(), &mentioned)
            .into_iter()
            .collect();
    parts.push(document_text);
    parts.join("\n\n")
}

/// The current user message as sent: the request context, then what the
/// user wrote.
pub(crate) fn request_user_text(context: &str, message: &str) -> String {
    format!("{context}\n\n---the user's message---\n{message}")
}

/// Tool output from an earlier exchange longer than this is cut to a stub
/// before being replayed: a file or section read three questions ago is
/// rarely needed again, and re-sending it with every request is most of what
/// made long conversations slow, expensive and finally too big to send.
const OLD_TOOL_OUTPUT_LIMIT: usize = 1_500;
const OLD_TOOL_OUTPUT_KEEP: usize = 400;
/// Past this much replayed history (characters), whole exchanges are dropped
/// oldest first, so a long session degrades into forgetting its beginning
/// instead of failing every send once it no longer fits the context window.
const HISTORY_BUDGET: usize = 150_000;

fn turn_chars(turn: &AgentTurn) -> usize {
    match turn {
        AgentTurn::User { text, .. } | AgentTurn::Assistant { text } => text.len(),
        AgentTurn::ToolCall { arguments, .. } => arguments.len(),
        AgentTurn::ToolResult { output, .. } => output.len(),
    }
}

/// Shrinks the replayed conversation (everything before the message being
/// sent) to what a writing agent still needs from it. propose_edit results
/// are never cut - they carry the accepted/rejected status notes the model
/// relies on. Edits nothing the user sees: the frontend keeps the full
/// history; only what goes to the provider is trimmed.
pub(crate) fn compact_history(history: Vec<AgentTurn>) -> Vec<AgentTurn> {
    let tool_names: std::collections::HashMap<String, String> = history
        .iter()
        .filter_map(|turn| match turn {
            AgentTurn::ToolCall { call_id, name, .. } => Some((call_id.clone(), name.clone())),
            _ => None,
        })
        .collect();
    let mut turns: Vec<AgentTurn> = history
        .into_iter()
        .map(|turn| match turn {
            AgentTurn::ToolResult { call_id, output }
                if output.chars().count() > OLD_TOOL_OUTPUT_LIMIT
                    && tool_names.get(&call_id).map(String::as_str) != Some("propose_edit") =>
            {
                let omitted = output.chars().count() - OLD_TOOL_OUTPUT_KEEP;
                let output = format!(
                    "{}\n[... {omitted} more characters of this earlier result omitted to save space - call the tool again if you need them]",
                    char_prefix(&output, OLD_TOOL_OUTPUT_KEEP)
                );
                AgentTurn::ToolResult { call_id, output }
            }
            turn => turn,
        })
        .collect();

    let mut total: usize = turns.iter().map(turn_chars).sum();
    while total > HISTORY_BUDGET {
        // One exchange: the leading user turn through the turn before the
        // next user turn - dropping whole exchanges keeps every tool call
        // paired with its result.
        let next_user = turns
            .iter()
            .skip(1)
            .position(|t| matches!(t, AgentTurn::User { .. }))
            .map(|i| i + 1);
        let Some(cut) = next_user else { break };
        total -= turns.drain(..cut).map(|t| turn_chars(&t)).sum::<usize>();
    }
    turns
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
    // `workspace_root`: Settings > Levis AI's explicit workspace override.
    // None keeps the default - the document's own folder (see
    // workspace::load).
    workspace_root: Option<String>,
    history: Vec<AgentTurn>,
    message: String,
    // `images`: attachments with no text to extract. The text-shaped ones
    // (PDF, Word, spreadsheets) were already extracted and inlined into
    // `message` by the frontend; only images travel as their own parts.
    images: Vec<ImageAttachment>,
    web_search: bool,
    mode: String,
    model: Option<String>,
    request_id: String,
    // Heading of the section the user is working in (see request_context).
    focus_heading: Option<String>,
    on_event: Channel<StreamEvent>,
) -> Result<Vec<AgentTurn>, String> {
    let cancel_rx = cancel::register(request_id.clone());
    let result = tokio::select! {
        result = ai_agent_message_inner(app, provider, document, doc_path, workspace_root, history, message, images, web_search, mode, model, focus_heading, on_event) => result,
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
    // `workspace_root`: Settings > Levis AI's explicit workspace override.
    // None keeps the default - the document's own folder (see
    // workspace::load).
    workspace_root: Option<String>,
    history: Vec<AgentTurn>,
    message: String,
    images: Vec<ImageAttachment>,
    web_search: bool,
    mode: String,
    model: Option<String>,
    focus_heading: Option<String>,
    on_event: Channel<StreamEvent>,
) -> Result<Vec<AgentTurn>, String> {
    let history = compact_history(history);
    let workspace = workspace::load(&app, doc_path.as_deref(), workspace_root.as_deref());
    let entry = catalog::find(&provider).ok_or_else(|| format!("unknown provider: {provider}"))?;

    // Refuse rather than drop. Sending the images to a provider that can't
    // read them would get an answer confidently written about a picture the
    // model never saw - the frontend hides the attach affordance for these
    // providers, so reaching here means something got out of step.
    if !images.is_empty() && !entry.supports_vision {
        return Err(format!(
            "{} can't read images. Remove the image, or switch provider in Settings.",
            entry.label
        ));
    }
    // Tool-calling paths: the document rides in this message (see
    // build_instructions). The tool-less fallback rebuilds its own turn.
    let user_turn = AgentTurn::User {
        text: request_user_text(
            &request_context(
                &workspace,
                &document,
                true,
                &message,
                focus_heading.as_deref(),
            ),
            &message,
        ),
        images,
    };
    let plain_message = message.clone();

    let result = match entry.dialect {
        "openai-responses" => {
            let instructions = build_instructions(&workspace, &document, true, &mode, &message);
            let tools = tools::builtin_tools(
                !workspace.skills.is_empty(),
                workspace.root.is_some(),
                mode == "edit",
            );
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
                    // Clamped, not just defaulted: a model saved while the
                    // API-key auth method was active is a hard 400 here.
                    let agent_model = openai_codex::usable_model(
                        model.as_deref(),
                        entry
                            .agent_default_model
                            .unwrap_or(openai_codex::COMPLETION_MODEL),
                    )
                    .to_string();
                    let step = |turns: Vec<AgentTurn>| {
                        let instructions = instructions.clone();
                        let tool_specs = tool_specs.clone();
                        let access_token = access_token.clone();
                        let account_id = account_id.clone();
                        let agent_model = agent_model.clone();
                        let channel = on_event.clone();
                        async move {
                            let sink = move |e: ProviderEvent<'_>| forward(&channel, e);
                            openai_codex::agent_step(
                                &access_token,
                                &account_id,
                                crate::app_identity::ORIGINATOR,
                                &instructions,
                                &turns,
                                &tool_specs,
                                web_search,
                                &agent_model,
                                &sink,
                            )
                            .await
                        }
                    };
                    run_agent_loop(
                        history,
                        user_turn,
                        MAX_STEPS,
                        step,
                        |name, arguments| tools::execute(&tools, &tool_ctx, name, arguments),
                        |turn| {
                            let _ = on_event.send(StreamEvent::Turn { turn: turn.clone() });
                        },
                    )
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
                        let channel = on_event.clone();
                        async move {
                            let sink = move |e: ProviderEvent<'_>| forward(&channel, e);
                            openai_api_key::agent_step(
                                &api_key,
                                &instructions,
                                &turns,
                                &tool_specs,
                                web_search,
                                &agent_model,
                                &sink,
                            )
                            .await
                        }
                    };
                    run_agent_loop(
                        history,
                        user_turn,
                        MAX_STEPS,
                        step,
                        |name, arguments| tools::execute(&tools, &tool_ctx, name, arguments),
                        |turn| {
                            let _ = on_event.send(StreamEvent::Turn { turn: turn.clone() });
                        },
                    )
                    .await
                }
            }
        }
        "anthropic-messages" => {
            let instructions = build_instructions(&workspace, &document, true, &mode, &message);
            let auth = route::resolve_anthropic_auth(&app).await?;
            let tools = tools::builtin_tools(
                !workspace.skills.is_empty(),
                workspace.root.is_some(),
                mode == "edit",
            );
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
                let channel = on_event.clone();
                async move {
                    let sink = move |e: ProviderEvent<'_>| forward(&channel, e);
                    anthropic::agent_step(
                        &auth,
                        &instructions,
                        &turns,
                        &tool_specs,
                        web_search,
                        &agent_model,
                        &sink,
                    )
                    .await
                }
            };

            run_agent_loop(
                history,
                user_turn,
                MAX_STEPS,
                step,
                |name, arguments| tools::execute(&tools, &tool_ctx, name, arguments),
                |turn| {
                    let _ = on_event.send(StreamEvent::Turn { turn: turn.clone() });
                },
            )
            .await
        }
        "openai-chat-completions" => {
            let (base_url, api_key, default_model) =
                route::resolve_chat_completions(&app, entry).await?;
            let endpoint_model = model
                .or_else(|| entry.agent_default_model.map(str::to_string))
                .or(default_model)
                .ok_or_else(|| NOT_CONFIGURED.to_string())?;
            let tools = tools::builtin_tools(
                !workspace.skills.is_empty(),
                workspace.root.is_some(),
                mode == "edit",
            );
            let tool_specs = tools::tool_specs(&tools);
            let tool_ctx = ToolContext {
                document: &document,
                skills: &workspace.skills,
                root: workspace.root.as_deref().map(Path::new),
            };
            let instructions_with_tools =
                build_instructions(&workspace, &document, true, &mode, &message);

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
                let channel = on_event.clone();
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
                    // `stream` support varies across OpenAI-compatible
                    // servers even more than `tools` does, so a failed
                    // streamed step is retried once without streaming
                    // before the outer flattened fallback gets a say. A
                    // genuine model/auth error just fails twice cheaply and
                    // surfaces the second (identical) error.
                    let sink = move |e: ProviderEvent<'_>| forward(&channel, e);
                    match custom::agent_step_streaming(
                        &base_url,
                        api_key.as_deref(),
                        &endpoint_model,
                        &instructions,
                        &turns,
                        &tool_specs,
                        native_web_search,
                        &sink,
                    )
                    .await
                    {
                        Ok(result) => Ok(result),
                        Err(_) => {
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
                    }
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
                user_turn,
                MAX_STEPS,
                step,
                |name, arguments| tools::execute(&tools, &tool_ctx, name, arguments),
                |turn| {
                    let _ = on_event.send(StreamEvent::Turn { turn: turn.clone() });
                },
            )
            .await
            {
                Ok(turns) => Ok(turns),
                Err(_) => {
                    let instructions =
                        build_instructions(&workspace, &document, false, &mode, &message);
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
            let instructions = build_instructions(&workspace, &document, false, &mode, &message);
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
    };
    // What history keeps is the message as the user wrote it - the document
    // copy was for this request only, and replaying it in every later
    // request would multiply the prompt by the number of turns.
    result.map(|mut turns| {
        if let Some(AgentTurn::User { text, .. }) = turns.first_mut() {
            *text = plain_message;
        }
        turns
    })
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
            // Images are dropped here on purpose: this path exists for
            // providers with no tool calling and no vision, and the command
            // has already refused an image-carrying message for those.
            AgentTurn::User { text, .. } => Some(format!("User: {text}")),
            AgentTurn::Assistant { text } => Some(format!("Assistant: {text}")),
            _ => None,
        }
    }

    let user_turn = AgentTurn::User {
        text: message,
        images: Vec::new(),
    };
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

    /// The whole tool path a writing request takes, with a scripted model:
    /// read the section it was asked about, propose an edit quoting it,
    /// get told when a quote doesn't match, retry with the right one.
    #[test]
    fn scripted_agent_reads_then_proposes_through_the_real_tools() {
        use aicompat::agent::StepResult;
        use std::cell::RefCell;
        use std::collections::VecDeque;

        let document = "# Notes\n\n## Methods\n\nWe sampled ten sites.\n\n## Results\n\nAll good.";
        let tools = tools::builtin_tools(false, false, true);
        let ctx = ToolContext {
            document,
            skills: &[],
            root: None,
        };
        let call = |id: &str, name: &str, args: &str| AgentTurn::ToolCall {
            call_id: id.into(),
            name: name.into(),
            arguments: args.into(),
        };
        let script = RefCell::new(VecDeque::from(vec![
            StepResult::ToolCalls(vec![call("r", "read_document", r#"{"heading":"Methods"}"#)]),
            StepResult::ToolCalls(vec![call(
                "bad",
                "propose_edit",
                r#"{"action":"replace","anchor":"We sampled 10 sites.","text":"x"}"#,
            )]),
            StepResult::ToolCalls(vec![call(
                "ok",
                "propose_edit",
                r#"{"action":"replace","anchor":"We sampled ten sites.","text":"We sampled ten coastal sites."}"#,
            )]),
            StepResult::Done("Named the site type.".into()),
        ]));
        let turns = tauri::async_runtime::block_on(run_agent_loop(
            vec![],
            AgentTurn::User {
                text: "Say which sites".into(),
                images: Vec::new(),
            },
            MAX_STEPS,
            |_| {
                let next = script.borrow_mut().pop_front().unwrap();
                async move { Ok(next) }
            },
            |name, args| tools::execute(&tools, &ctx, name, args),
            |_| {},
        ))
        .unwrap();

        let result = |id: &str| {
            turns
                .iter()
                .find_map(|t| match t {
                    AgentTurn::ToolResult { call_id, output } if call_id == id => {
                        Some(output.clone())
                    }
                    _ => None,
                })
                .unwrap()
        };
        assert!(result("r").contains("We sampled ten sites."));
        assert!(!result("r").contains("All good."));
        assert!(
            result("bad").starts_with("No exact match"),
            "{}",
            result("bad")
        );
        assert!(
            result("ok").starts_with("Edit proposed"),
            "{}",
            result("ok")
        );
    }

    #[test]
    fn compact_history_stubs_old_reads_but_keeps_edit_results() {
        let big = "x".repeat(5_000);
        let history = vec![
            AgentTurn::User {
                text: "q".into(),
                images: Vec::new(),
            },
            AgentTurn::ToolCall {
                call_id: "r".into(),
                name: "read_file".into(),
                arguments: "{}".into(),
            },
            AgentTurn::ToolResult {
                call_id: "r".into(),
                output: big.clone(),
            },
            AgentTurn::ToolCall {
                call_id: "e".into(),
                name: "propose_edit".into(),
                arguments: "{}".into(),
            },
            AgentTurn::ToolResult {
                call_id: "e".into(),
                output: big.clone(),
            },
        ];
        let out = compact_history(history);
        let AgentTurn::ToolResult { output, .. } = &out[2] else {
            panic!()
        };
        assert!(output.len() < 1_000 && output.contains("omitted"));
        let AgentTurn::ToolResult { output, .. } = &out[4] else {
            panic!()
        };
        assert_eq!(output, &big);
    }

    #[test]
    fn compact_history_drops_whole_oldest_exchanges_over_budget() {
        let long = "y".repeat(HISTORY_BUDGET);
        let history = vec![
            AgentTurn::User {
                text: long.clone(),
                images: Vec::new(),
            },
            AgentTurn::Assistant { text: "a1".into() },
            AgentTurn::User {
                text: "recent".into(),
                images: Vec::new(),
            },
            AgentTurn::Assistant { text: "a2".into() },
        ];
        let out = compact_history(history);
        assert_eq!(out.len(), 2);
        assert!(matches!(&out[0], AgentTurn::User { text, .. } if text == "recent"));
    }

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
        let section = document_section(doc, true, None);
        assert_eq!(section, format!("---document---\n{doc}"));
    }

    #[test]
    fn long_document_is_truncated_with_outline_and_excerpts() {
        let middle = "x".repeat(FULL_DOCUMENT_LIMIT + 1000);
        let doc = format!("# Start\n\nfirst-marker {middle} last-marker\n\n## End");
        let section = document_section(&doc, true, None);
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
        let section = document_section(&doc, false, None);
        assert!(!section.contains("search_document"));
    }

    #[test]
    fn excerpts_are_char_boundary_safe_for_cjk() {
        // Every char here is multi-byte - a byte-index slice at a fixed
        // offset would panic mid-character.
        let doc = "中".repeat(FULL_DOCUMENT_LIMIT + 500);
        let section = document_section(&doc, true, None);
        assert!(section.contains('中'));
    }

    #[test]
    fn a_long_document_still_carries_the_section_being_worked_on() {
        let mut doc = String::from("# Report\n\n");
        for i in 0..60 {
            doc.push_str(&format!(
                "## Part {i}\n\n{}\n\n",
                "filler text. ".repeat(80)
            ));
        }
        doc.push_str("## Target\n\nThe paragraph the user is editing.\n\n## After\n\nmore");
        let section = document_section(&doc, true, Some("Target"));
        assert!(section.contains("truncated"));
        assert!(section.contains("The paragraph the user is editing."));
        // The section ends where the next heading of its level starts.
        let (line, focus) = focus_section(&doc, "Target").unwrap();
        assert!(focus.starts_with("## Target"));
        assert!(!focus.contains("## After"));
        assert_eq!(doc.lines().nth(line - 1), Some("## Target"));
        assert!(!document_section(&doc, true, None).contains("the section the user is working in"));
    }

    #[test]
    fn style_and_mentioned_library_entries_reach_the_prompt() {
        let workspace = AgentWorkspace {
            style: Some("Short sentences. No adverbs.".into()),
            library: vec![
                crate::ai::project::parse_library_entry(
                    "a",
                    "a",
                    "---\nname: 林晚\naliases: [晚晚]\n---\n中学语文老师。",
                ),
                crate::ai::project::parse_library_entry(
                    "b",
                    "b",
                    "---\nname: 港城\n---\n海边城市。",
                ),
            ],
            ..AgentWorkspace::default()
        };
        let prompt = request_context(&workspace, "晚晚推开门。", true, "改写这句", None);
        assert!(prompt.contains("Short sentences. No adverbs."));
        assert!(
            prompt.contains("中学语文老师"),
            "mentioned via alias in the document"
        );
        assert!(!prompt.contains("海边城市"), "not mentioned anywhere");
    }

    #[test]
    fn interaction_mode_is_explicit_in_the_system_instructions() {
        let workspace = AgentWorkspace::default();
        let plan = build_instructions(&workspace, "draft", true, "plan", "");
        assert!(plan.contains("interaction mode: plan"));
        assert!(plan.contains("do not call propose_edit"));

        let edit = build_instructions(&workspace, "draft", true, "edit", "");
        assert!(edit.contains("interaction mode: edit"));
    }
}
