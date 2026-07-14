use aicompat::agent::ToolSpec;
use serde_json::json;

/// Everything a tool implementation needs to actually do its work. Grows as
/// more tools need more context (e.g. an MCP client handle) without changing
/// each tool's call signature.
pub struct ToolContext<'a> {
    pub document: &'a str,
}

/// A tool the agent can call, paired with its local implementation. Built-in
/// tools (like `search_document` below) implement `run` directly; a future
/// MCP integration would instead build this list by asking a connected MCP
/// server for its tool specs and forwarding `run` to an MCP `tools/call`
/// request - the registry and dispatch below don't need to change either way.
pub struct Tool {
    pub spec: ToolSpec,
    pub run: fn(&ToolContext, &str) -> String,
}

const SEARCH_TOOL_NAME: &str = "search_document";

fn search_document(ctx: &ToolContext, arguments: &str) -> String {
    let query = serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|v| v.get("query").and_then(|q| q.as_str()).map(|s| s.to_string()))
        .unwrap_or_default();

    if query.trim().is_empty() {
        return "No query provided.".to_string();
    }

    let query_lower = query.to_lowercase();
    let matches: Vec<String> = ctx
        .document
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

const PROPOSE_EDIT_TOOL_NAME: &str = "propose_edit";

/// The edit operations the frontend knows how to apply. Kept in sync with
/// `EditAction` in src/ai/types.ts - adding one here without teaching
/// useInlineChat.applyProposal about it produces proposals that validate but
/// can't be applied.
const EDIT_ACTIONS: [&str; 5] = ["replace", "insert_before", "insert_after", "delete", "append"];

fn needs_anchor(action: &str) -> bool {
    action != "append"
}

fn needs_text(action: &str) -> bool {
    action != "delete"
}

/// Doesn't modify anything itself - the document only ever changes through
/// the user clicking Apply in the frontend. This validates the proposal
/// against the same rules the frontend applies with (known action, required
/// fields present, `anchor` matching the document exactly once) so the model
/// gets immediate feedback instead of the user getting a dead Apply button.
fn propose_edit(ctx: &ToolContext, arguments: &str) -> String {
    let parsed: serde_json::Value = match serde_json::from_str(arguments) {
        Ok(v) => v,
        Err(_) => return "Invalid arguments - expected JSON with an `action` string.".to_string(),
    };
    let action = parsed.get("action").and_then(|v| v.as_str()).unwrap_or("");
    if !EDIT_ACTIONS.contains(&action) {
        return format!(
            "Unknown action `{action}`. Use one of: {}.",
            EDIT_ACTIONS.join(", ")
        );
    }

    let anchor = parsed.get("anchor").and_then(|v| v.as_str()).unwrap_or("");
    let has_text = parsed.get("text").and_then(|v| v.as_str()).is_some();
    if needs_text(action) && !has_text {
        return format!("`{action}` requires `text` - the new content.");
    }
    if needs_anchor(action) {
        if anchor.is_empty() {
            return format!("`{action}` requires `anchor` - the exact document text the edit targets.");
        }
        match ctx.document.matches(anchor).count() {
            0 => return "No exact match for `anchor` in the document. Quote it exactly as it appears, including punctuation and whitespace.".to_string(),
            1 => {}
            n => return format!("`anchor` appears {n} times in the document. Include more surrounding text so it matches exactly once."),
        }
    }

    "Edit proposed - the user now sees it with an Apply button. Don't repeat the full text in your reply; just say briefly what you changed and why.".to_string()
}

/// The tools available to every agent conversation right now. Append here
/// (or extend to merge in MCP-provided tools) as the toolset grows.
pub fn builtin_tools() -> Vec<Tool> {
    vec![
        Tool {
            spec: ToolSpec {
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
            },
            run: search_document,
        },
        Tool {
            spec: ToolSpec {
                name: PROPOSE_EDIT_TOOL_NAME,
                description: "Propose one edit to the document. Nothing is modified directly: the user reviews the proposal and applies it with one click. Call once per distinct edit. Pick the action that matches the intent: `replace` swaps `anchor` for `text`; `insert_before`/`insert_after` add `text` around an untouched `anchor`; `delete` removes `anchor`; `append` adds `text` at the end of the document. `anchor` must be copied verbatim from the document and occur exactly once.",
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": EDIT_ACTIONS,
                            "description": "What kind of edit this is"
                        },
                        "anchor": {
                            "type": "string",
                            "description": "Exact existing document text the edit targets, quoted verbatim. Required for every action except `append`."
                        },
                        "text": {
                            "type": "string",
                            "description": "The new content (markdown). Required for every action except `delete`."
                        }
                    },
                    "required": ["action"],
                }),
            },
            run: propose_edit,
        },
    ]
}

pub fn tool_specs(tools: &[Tool]) -> Vec<ToolSpec> {
    tools.iter().map(|t| t.spec.clone()).collect()
}

pub fn execute(tools: &[Tool], ctx: &ToolContext, name: &str, arguments: &str) -> String {
    match tools.iter().find(|t| t.spec.name == name) {
        Some(tool) => (tool.run)(ctx, arguments),
        None => format!("Unknown tool: {name}"),
    }
}
