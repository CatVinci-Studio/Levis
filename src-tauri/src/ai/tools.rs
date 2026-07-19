use crate::ai::workspace::AgentSkill;
use aicompat::agent::ToolSpec;
use serde_json::json;
use std::path::Path;

/// Everything a tool implementation needs to actually do its work. Grows as
/// more tools need more context (e.g. an MCP client handle) without changing
/// each tool's call signature.
pub struct ToolContext<'a> {
    pub document: &'a str,
    /// Skills from the agent workspace (global + document folder).
    pub skills: &'a [AgentSkill],
    /// The document's folder - the sandbox root for the file tools. None for
    /// unsaved drafts (the file tools aren't offered then).
    pub root: Option<&'a Path>,
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
        .and_then(|v| {
            v.get("query")
                .and_then(|q| q.as_str())
                .map(|s| s.to_string())
        })
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
const EDIT_ACTIONS: [&str; 6] = [
    "replace",
    "replace_selection",
    "insert_before",
    "insert_after",
    "delete",
    "append",
];

fn needs_anchor(action: &str) -> bool {
    // replace_selection targets the user's captured selection, so there is
    // no anchor to locate (and the selection may not be unique in the
    // document anyway - that's the point of having the action).
    action != "append" && action != "replace_selection"
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
            return format!(
                "`{action}` requires `anchor` - the exact document text the edit targets."
            );
        }
        match ctx.document.matches(anchor).count() {
            0 => return "No exact match for `anchor` in the document. Quote it exactly as it appears, including punctuation and whitespace.".to_string(),
            1 => {}
            n => return format!("`anchor` appears {n} times in the document. Include more surrounding text so it matches exactly once."),
        }
    }

    "Edit proposed - the user now sees it with an Apply button. Don't repeat the full text in your reply; just say briefly what you changed and why.".to_string()
}

const USE_SKILL_TOOL_NAME: &str = "use_skill";

/// Dynamic skill loading: the system prompt only carries each skill's name
/// and description; this returns the full instructions on demand.
fn use_skill(ctx: &ToolContext, arguments: &str) -> String {
    let name = serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|v| {
            v.get("name")
                .and_then(|n| n.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default();

    match ctx.skills.iter().find(|s| s.name == name) {
        Some(skill) => format!(
            "Instructions for skill `{name}` - follow them for this request:\n\n{}",
            skill.prompt
        ),
        None => {
            let available: Vec<&str> = ctx.skills.iter().map(|s| s.name.as_str()).collect();
            format!(
                "No skill named `{name}`. Available skills: {}.",
                available.join(", ")
            )
        }
    }
}

const LIST_FILES_TOOL_NAME: &str = "list_files";
const READ_FILE_TOOL_NAME: &str = "read_file";

/// How much of the workspace the file tools expose: enough for reference
/// material next to the document, small enough that a huge folder can't
/// blow up the prompt.
const MAX_LISTED_FILES: usize = 200;
const MAX_READ_BYTES: u64 = 100 * 1024;

/// Recursive listing of the workspace folder (paths relative to it),
/// skipping dotfiles - .levis, .git and friends are configuration, not
/// writing material.
fn list_files(ctx: &ToolContext, _arguments: &str) -> String {
    let Some(root) = ctx.root else {
        return "This document isn't saved to a folder yet, so there are no files to list."
            .to_string();
    };

    let mut lines = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut paths: Vec<_> = entries.flatten().map(|e| e.path()).collect();
        paths.sort();
        for path in paths {
            if lines.len() >= MAX_LISTED_FILES {
                lines.push(format!("... (stopped at {MAX_LISTED_FILES} entries)"));
                return lines.join("\n");
            }
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            if name.starts_with('.') {
                continue;
            }
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();
            if path.is_dir() {
                lines.push(format!("{rel}/"));
                pending.push(path);
            } else {
                lines.push(rel);
            }
        }
    }

    if lines.is_empty() {
        "The document's folder is empty.".to_string()
    } else {
        lines.join("\n")
    }
}

/// Reads a text file from inside the workspace. The canonicalized path must
/// stay under the workspace root - `..`, absolute paths, and symlinks out of
/// the workspace all fail the containment check rather than escaping it.
fn read_file(ctx: &ToolContext, arguments: &str) -> String {
    let Some(root) = ctx.root else {
        return "This document isn't saved to a folder yet, so there are no files to read."
            .to_string();
    };
    let rel = serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|v| {
            v.get("path")
                .and_then(|p| p.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default();
    if rel.trim().is_empty() {
        return "No path provided.".to_string();
    }

    let (Ok(root_canon), Ok(path)) = (root.canonicalize(), root.join(&rel).canonicalize()) else {
        return format!("`{rel}` doesn't exist. Use list_files to see what's available.");
    };
    if !path.starts_with(&root_canon) {
        return "That path is outside the document's folder - only files inside it can be read."
            .to_string();
    }

    match std::fs::metadata(&path) {
        Ok(meta) if meta.len() > MAX_READ_BYTES => {
            format!(
                "`{rel}` is too large to read ({} KB; the limit is {} KB).",
                meta.len() / 1024,
                MAX_READ_BYTES / 1024
            )
        }
        _ => match std::fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => format!("`{rel}` isn't a readable text file."),
        },
    }
}

/// The tools available to an agent conversation. Skill and file tools are
/// only offered when there's something for them to work on - a tool that can
/// only report "nothing there" would just waste the model's steps. Append
/// here (or extend to merge in MCP-provided tools) as the toolset grows.
pub fn builtin_tools(has_skills: bool, has_root: bool) -> Vec<Tool> {
    let mut tools = vec![
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
                description: "Propose one edit to the document. Nothing is modified directly: the user reviews the proposal and applies it with one click. Call once per distinct edit. Pick the action that matches the intent: `replace` swaps `anchor` for `text`; `replace_selection` swaps the user's currently selected text (the <selected-text> block in their message; no `anchor` needed) for `text`; `insert_before`/`insert_after` add `text` around an untouched `anchor`; `delete` removes `anchor`; `append` adds `text` at the end of the document. `anchor` must be copied verbatim from the document and occur exactly once. `text` must be valid markdown: `-` or `1.` for lists (never `•` or other bullet symbols), `#` for headings.",
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
    ];

    if has_skills {
        tools.push(Tool {
            spec: ToolSpec {
                name: USE_SKILL_TOOL_NAME,
                description: "Load the full instructions of one of the available skills (listed in the system prompt). Call this before following a skill whenever the user's request matches its description, or when the user invokes it by name.",
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "The skill's name, exactly as listed"
                        }
                    },
                    "required": ["name"],
                }),
            },
            run: use_skill,
        });
    }

    if has_root {
        tools.push(Tool {
            spec: ToolSpec {
                name: LIST_FILES_TOOL_NAME,
                description: "List the files in the document's folder (recursively, paths relative to it). Use it to discover reference material - notes, other chapters, data - before reading one.",
                parameters: json!({"type": "object", "properties": {}}),
            },
            run: list_files,
        });
        tools.push(Tool {
            spec: ToolSpec {
                name: READ_FILE_TOOL_NAME,
                description: "Read a text file from the document's folder. Use the relative path as shown by list_files.",
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path relative to the document's folder"
                        }
                    },
                    "required": ["path"],
                }),
            },
            run: read_file,
        });
    }

    tools
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
