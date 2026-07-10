use crate::ai::tools::{self, ToolContext};
use aicompat::agent::{run_agent_loop, AgentTurn};
use aicompat::providers::openai_codex;
use tauri::AppHandle;

const MAX_STEPS: usize = 6;

const AGENT_INSTRUCTIONS_PREFIX: &str = "You are a helpful writing assistant embedded in a markdown editor. The user is asking about the document they currently have open (given below). Be concise.";

/// Only appended for providers that actually run the tool loop (codex) -
/// telling a tool-less provider to call tools would just confuse it.
const AGENT_TOOL_INSTRUCTIONS: &str = "Use the search_document tool to locate something specific in a long document rather than guessing. When the user asks you to change, rewrite, or fix part of the document, call propose_edit (once per distinct edit) with the exact current text and its replacement - the user reviews and applies each proposal themselves, so don't also paste the full rewritten text into your reply.";

/// Sends one user message and runs the conversation forward, returning the
/// new turns produced (the user's own turn, any tool calls/results, and the
/// final assistant reply) for the frontend to append to its history.
///
/// Tool calling only runs for the "codex" provider, which is the one that
/// actually supports it end to end right now - the others just get a
/// flattened-history chat completion. The orchestration loop itself
/// (`run_agent_loop`) and the tool implementations (`crate::ai::tools`) don't
/// know that - adding tool-calling support for another provider is just
/// wiring up its own `step` closure the way `codex_step` does below.
#[tauri::command]
pub async fn ai_agent_message(
    app: AppHandle,
    provider: String,
    document: String,
    history: Vec<AgentTurn>,
    message: String,
) -> Result<Vec<AgentTurn>, String> {
    if provider != "codex" {
        let instructions = format!("{AGENT_INSTRUCTIONS_PREFIX}\n\n---document---\n{document}");
        return flattened_chat_turn(&app, &provider, &instructions, history, message).await;
    }

    let instructions = format!("{AGENT_INSTRUCTIONS_PREFIX} {AGENT_TOOL_INSTRUCTIONS}\n\n---document---\n{document}");

    let (access_token, account_id) = crate::auth::openai_codex::get_valid_credential(&app).await?;
    let tools = tools::builtin_tools();
    let tool_specs = tools::tool_specs(&tools);
    let tool_ctx = ToolContext { document: &document };

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
