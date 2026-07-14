use crate::ai::tools::{self, ToolContext};
use crate::ai::workspace::{self, AgentWorkspace};
use aicompat::agent::{run_agent_loop, AgentTurn};
use aicompat::providers::openai_codex;
use std::path::Path;
use tauri::AppHandle;

/// Skill loads, file reads, and web searches all consume steps, so a
/// research-y request needs more headroom than the old chat-only loop did.
const MAX_STEPS: usize = 12;

const AGENT_ROLE: &str = "You are a professional writing assistant embedded in Levis, a markdown editor. You help the user plan, draft, revise, and polish their writing: outlining, continuing a draft, rewriting for tone or clarity, critiquing structure and argument, checking facts, and answering questions about the document they have open (included below). Reply in the same language the user writes in. Be concise and concrete - when giving feedback, point at specific passages instead of generalities.";

/// Only appended for providers that actually run the tool loop (codex) -
/// telling a tool-less provider to call tools would just confuse it.
const AGENT_TOOL_INSTRUCTIONS: &str = "Use the search_document tool to locate something specific in a long document rather than guessing. The document's folder may hold reference material - use list_files/read_file to consult it when the user's request depends on it. When the user asks you to change the document, call propose_edit (once per distinct edit) with the action that matches the intent - replace to swap existing text, insert_before/insert_after to add text next to existing text, delete to remove text, append to add text at the end of the document. `anchor` must be quoted verbatim from the document and occur exactly once. The user reviews and applies each proposal themselves, so don't also paste the full rewritten text into your reply.";

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

    sections.push(format!("---document---\n{document}"));
    sections.join("\n\n")
}

/// Sends one user message and runs the conversation forward, returning the
/// new turns produced (the user's own turn, any tool calls/results, and the
/// final assistant reply) for the frontend to append to its history.
///
/// Tool calling only runs for the "codex" provider, which is the one that
/// actually supports it end to end right now - the others just get a
/// flattened-history chat completion (with the workspace's agent.md layers
/// still in the system prompt; skills reach them via the frontend's /name
/// injection instead of use_skill). The orchestration loop (`run_agent_loop`)
/// and the tool implementations (`crate::ai::tools`) don't know that -
/// adding tool-calling support for another provider is just wiring up its
/// own `step` closure the way `codex_step` does below.
#[tauri::command]
pub async fn ai_agent_message(
    app: AppHandle,
    provider: String,
    document: String,
    doc_path: Option<String>,
    history: Vec<AgentTurn>,
    message: String,
    web_search: bool,
) -> Result<Vec<AgentTurn>, String> {
    let workspace = workspace::load(&app, doc_path.as_deref());

    if provider != "codex" {
        let instructions = build_instructions(&workspace, &document, false);
        return flattened_chat_turn(&app, &provider, &instructions, history, message).await;
    }

    let instructions = build_instructions(&workspace, &document, true);

    let (access_token, account_id) = crate::auth::openai_codex::get_valid_credential(&app).await?;
    let tools = tools::builtin_tools(!workspace.skills.is_empty(), workspace.root.is_some());
    let tool_specs = tools::tool_specs(&tools);
    let tool_ctx = ToolContext {
        document: &document,
        skills: &workspace.skills,
        root: workspace.root.as_deref().map(Path::new),
    };

    let codex_step = |turns: Vec<AgentTurn>| {
        let instructions = instructions.clone();
        let tool_specs = tool_specs.clone();
        let access_token = access_token.clone();
        let account_id = account_id.clone();
        async move {
            openai_codex::agent_step(
                &access_token,
                &account_id,
                crate::app_identity::ORIGINATOR,
                &instructions,
                &turns,
                &tool_specs,
                web_search,
            )
            .await
        }
    };

    run_agent_loop(history, message, MAX_STEPS, codex_step, |name, arguments| {
        tools::execute(&tools, &tool_ctx, name, arguments)
    })
    .await
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

    let text = crate::ai::client::call(app, provider, instructions.to_string(), transcript.join("\n\n")).await?;
    Ok(vec![user_turn, AgentTurn::Assistant { text }])
}
