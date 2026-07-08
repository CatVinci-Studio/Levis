use aicompat::agent::{AgentTurn, StepResult, ToolSpec};
use aicompat::providers::openai_codex;
use serde_json::json;
use tauri::AppHandle;

const SEARCH_TOOL_NAME: &str = "search_document";
const MAX_STEPS: usize = 6;

const AGENT_INSTRUCTIONS_PREFIX: &str = "You are a helpful writing assistant embedded in a markdown editor. The user is asking about the document they currently have open (given below). Use the search_document tool if you need to locate something specific in a long document rather than guessing. Be concise.";

fn search_tool_spec() -> ToolSpec {
    ToolSpec {
        name: SEARCH_TOOL_NAME,
        description: "Search the current document for a query string (case-insensitive). Returns matching lines with their line numbers.",
        parameters: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Text to search for in the document"
                }
            },
            "required": ["query"],
        }),
    }
}

fn execute_search(document: &str, arguments: &str) -> String {
    let query = serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|v| v.get("query").and_then(|q| q.as_str()).map(|s| s.to_string()))
        .unwrap_or_default();

    if query.trim().is_empty() {
        return "No query provided.".to_string();
    }

    let query_lower = query.to_lowercase();
    let matches: Vec<String> = document
        .lines()
        .enumerate()
        .filter(|(_, line)| line.to_lowercase().contains(&query_lower))
        .map(|(i, line)| format!("{}: {}", i + 1, line))
        .take(20)
        .collect();

    if matches.is_empty() {
        format!("No matches found for \"{query}\".")
    } else {
        matches.join("\n")
    }
}

fn turn_to_plain_text(turn: &AgentTurn) -> Option<String> {
    match turn {
        AgentTurn::User { text } => Some(format!("User: {text}")),
        AgentTurn::Assistant { text } => Some(format!("Assistant: {text}")),
        _ => None,
    }
}

/// Sends one user message and runs the conversation forward, returning the
/// new turns produced (the user's own turn, any tool calls/results, and the
/// final assistant reply) for the frontend to append to its history.
///
/// Tool calling (search_document) only runs for the "codex" provider, which
/// is the one that actually supports it end to end right now - the others
/// just get a flattened-history chat completion.
#[tauri::command]
pub async fn ai_agent_message(
    app: AppHandle,
    provider: String,
    document: String,
    history: Vec<AgentTurn>,
    message: String,
) -> Result<Vec<AgentTurn>, String> {
    let instructions = format!("{AGENT_INSTRUCTIONS_PREFIX}\n\n---document---\n{document}");
    let user_turn = AgentTurn::User { text: message };

    if provider != "codex" {
        let mut transcript: Vec<String> = history.iter().filter_map(turn_to_plain_text).collect();
        if let Some(t) = turn_to_plain_text(&user_turn) {
            transcript.push(t);
        }
        let text = crate::ai::client::call(&app, &provider, instructions, transcript.join("\n\n")).await?;
        return Ok(vec![user_turn, AgentTurn::Assistant { text }]);
    }

    let (access_token, account_id) = crate::auth::openai_codex::get_valid_credential(&app).await?;
    let tools = vec![search_tool_spec()];

    let mut turns = history;
    turns.push(user_turn.clone());
    let mut new_turns = vec![user_turn];

    for _ in 0..MAX_STEPS {
        let step = openai_codex::agent_step(
            &access_token,
            &account_id,
            crate::app_identity::ORIGINATOR,
            &instructions,
            &turns,
            &tools,
        )
        .await?;

        match step {
            StepResult::Done(text) => {
                let turn = AgentTurn::Assistant { text };
                new_turns.push(turn);
                break;
            }
            StepResult::ToolCalls(calls) => {
                for call in calls {
                    let AgentTurn::ToolCall { call_id, name, arguments } = &call else {
                        continue;
                    };
                    turns.push(call.clone());
                    new_turns.push(call.clone());

                    let output = if name == SEARCH_TOOL_NAME {
                        execute_search(&document, arguments)
                    } else {
                        format!("Unknown tool: {name}")
                    };

                    let result_turn = AgentTurn::ToolResult {
                        call_id: call_id.clone(),
                        output,
                    };
                    turns.push(result_turn.clone());
                    new_turns.push(result_turn);
                }
            }
        }
    }

    Ok(new_turns)
}
