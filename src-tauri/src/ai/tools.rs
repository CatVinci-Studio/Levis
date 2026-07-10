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

/// Doesn't modify anything itself - the document only ever changes through
/// the user clicking Apply in the frontend. This validates the proposal
/// (the `find` text must match the document exactly once, or the frontend
/// couldn't locate it unambiguously) and tells the model what happens next.
fn propose_edit(ctx: &ToolContext, arguments: &str) -> String {
    let parsed: serde_json::Value = match serde_json::from_str(arguments) {
        Ok(v) => v,
        Err(_) => return "Invalid arguments - expected JSON with `find` and `replace` strings.".to_string(),
    };
    let find = parsed.get("find").and_then(|v| v.as_str()).unwrap_or("");
    if find.is_empty() {
        return "Provide the exact document text to replace in `find`.".to_string();
    }
    if parsed.get("replace").and_then(|v| v.as_str()).is_none() {
        return "Provide the replacement text in `replace`.".to_string();
    }

    match ctx.document.matches(find).count() {
        0 => "No exact match for that text in the document. Quote it exactly as it appears, including punctuation and whitespace.".to_string(),
        1 => "Edit proposed - the user now sees it with an Apply button. Don't repeat the full replacement text in your reply; just say briefly what you changed and why.".to_string(),
        n => format!("That text appears {n} times in the document. Include more surrounding text in `find` so it matches exactly once."),
    }
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
                description: "Propose replacing one exact snippet of the document with new text. Nothing is modified directly: the user reviews the proposal and applies it with one click. `find` must be copied exactly from the document and must occur exactly once; call this once per distinct edit.",
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "find": {
                            "type": "string",
                            "description": "The exact current document text to replace, quoted verbatim"
                        },
                        "replace": {
                            "type": "string",
                            "description": "The text to replace it with"
                        }
                    },
                    "required": ["find", "replace"],
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
