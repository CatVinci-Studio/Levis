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
    /// The workspace root - the sandbox boundary for the file tools. The
    /// document's own folder by default, or the folder chosen in Settings >
    /// Agent (see workspace::resolve_root). None for an unsaved draft with no
    /// override, in which case the file tools aren't offered at all.
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

const READ_DOCUMENT_TOOL_NAME: &str = "read_document";

/// Most a single read_document call returns; a longer range comes back cut
/// at a line boundary with a pointer to where to continue.
const MAX_READ_DOCUMENT_CHARS: usize = 12_000;

/// The ATX heading level of a markdown line (`## Title` -> 2), or None.
fn heading_level(line: &str) -> Option<usize> {
    let trimmed = line.trim_start();
    let hashes = trimmed.chars().take_while(|&c| c == '#').count();
    ((1..=6).contains(&hashes) && trimmed.as_bytes().get(hashes) == Some(&b' ')).then_some(hashes)
}

/// Line indexes (0-based) of headings outside fenced code blocks - a `# `
/// comment in a shell snippet isn't a section.
pub(crate) fn heading_lines(lines: &[&str]) -> Vec<(usize, usize)> {
    let mut in_fence = false;
    let mut headings = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if !in_fence {
            if let Some(level) = heading_level(line) {
                headings.push((i, level));
            }
        }
    }
    headings
}

/// The line range `[start, end)` of the section under `heading`: from the
/// heading to the next one at its level or above, so "Methods" includes its
/// subsections. An exact title wins; otherwise the first heading containing
/// it, ignoring case. Shared by read_document and agent.rs's focus section,
/// so "section" means the same thing to the model and to the prompt.
pub(crate) fn section_range(lines: &[&str], heading: &str) -> Option<(usize, usize)> {
    let wanted = heading.trim().trim_start_matches('#').trim();
    if wanted.is_empty() {
        return None;
    }
    let headings = heading_lines(lines);
    let title = |i: usize| lines[i].trim_start().trim_start_matches('#').trim();
    let lower = wanted.to_lowercase();
    let pos = headings
        .iter()
        .position(|&(i, _)| title(i) == wanted)
        .or_else(|| {
            headings
                .iter()
                .position(|&(i, _)| title(i).to_lowercase().contains(&lower))
        })?;
    let (first, level) = headings[pos];
    let last = headings[pos + 1..]
        .iter()
        .find(|&&(_, l)| l <= level)
        .map_or(lines.len(), |&(i, _)| i);
    Some((first, last))
}

/// Reads part of the document verbatim - a section by its heading, or a
/// line range. The embedded document is only an outline plus excerpts once
/// it is long (agent.rs's document_section), and search_document only ever
/// shows single lines: without this the model had no way to see a whole
/// passage it was asked to revise, nor a multi-line anchor to quote.
fn read_document(ctx: &ToolContext, arguments: &str) -> String {
    let args: serde_json::Value = serde_json::from_str(arguments).unwrap_or_default();
    let lines: Vec<&str> = ctx.document.lines().collect();
    if lines.is_empty() {
        return "The document is empty.".to_string();
    }
    let total = lines.len();

    let (start, end) = if let Some(heading) = args
        .get("heading")
        .and_then(|h| h.as_str())
        .map(str::trim)
        .filter(|h| !h.is_empty())
    {
        match section_range(&lines, heading) {
            Some(range) => range,
            None => {
                return format!("No heading matching \"{heading}\". The outline in the document section lists them.")
            }
        }
    } else {
        let line_arg = |key: &str| args.get(key).and_then(|v| v.as_u64()).map(|n| n as usize);
        let start = line_arg("start_line").unwrap_or(1).clamp(1, total) - 1;
        let end = line_arg("end_line")
            .unwrap_or(total)
            .clamp(start + 1, total);
        (start, end)
    };

    let mut out = String::new();
    let mut shown_end = start;
    for line in &lines[start..end] {
        if !out.is_empty() && out.len() + line.len() + 1 > MAX_READ_DOCUMENT_CHARS {
            break;
        }
        out.push_str(line);
        out.push('\n');
        shown_end += 1;
    }
    let mut header = format!("Lines {}-{} of {total}:", start + 1, shown_end);
    if shown_end < end {
        header.push_str(&format!(
            " (cut for length - continue with start_line={})",
            shown_end + 1
        ));
    }
    format!("{header}\n{out}")
}

const PROPOSE_EDIT_TOOL_NAME: &str = "propose_edit";

/// The edit operations the frontend knows how to apply. Kept in sync with
/// `EditAction` in src/ai/types.ts - adding one here without teaching
/// the frontend (usePendingEdits.ts, which resolves proposals, and
/// apply-edit.ts, which writes them) about it produces proposals that validate but
/// can't be applied.
const EDIT_ACTIONS: [&str; 7] = [
    "replace",
    "replace_selection",
    "insert_before",
    "insert_after",
    "delete",
    "append",
    "insert_at_cursor",
];

fn needs_anchor(action: &str) -> bool {
    // replace_selection targets the user's captured selection, so there is
    // no anchor to locate (and the selection may not be unique in the
    // document anyway - that's the point of having the action).
    action != "append" && action != "replace_selection" && action != "insert_at_cursor"
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
        if let Err(problem) = check_anchor(ctx.document, &parsed, anchor) {
            return problem;
        }
    }

    // On later requests the frontend appends a bracketed status note to this
    // result (accepted / rejected / still undecided) - see
    // annotateProposalStatuses in src/ai/proposal-status.ts. The size of
    // the change is measured here so the reply can rest on it: replies
    // called a 20% cut "about 70% of the original" and an expansion that
    // shrank "expanded into two paragraphs" (docs/AI-EVAL.md, round 2).
    let text = parsed.get("text").and_then(|v| v.as_str()).unwrap_or("");
    let size = match action {
        "replace" => {
            let (from, unit) = text_size(anchor);
            let (to, _) = text_size(text);
            format!(" It replaces {from} {unit} with {to}.")
        }
        "delete" => {
            let (n, unit) = text_size(anchor);
            format!(" It removes {n} {unit}.")
        }
        "replace_selection" => String::new(),
        _ => {
            let (n, unit) = text_size(text);
            format!(" It adds {n} {unit}.")
        }
    };
    format!("Edit proposed - the user now sees it with an Apply button.{size} This is your proposal for that passage in this reply - don't send another one for it. In your reply, say in a sentence or two what you proposed and why; don't repeat the text or list what you kept.")
}

/// How long a stretch of text is, in the unit its language counts in:
/// characters for Chinese and Japanese, words otherwise.
fn text_size(text: &str) -> (usize, &'static str) {
    let cjk = text
        .chars()
        .filter(|c| matches!(c, '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}'))
        .count();
    let words = text
        .split_whitespace()
        .filter(|w| w.chars().any(|c| c.is_alphanumeric() && !matches!(c, '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}')))
        .count();
    if cjk > words {
        (cjk, "characters")
    } else {
        (words, "words")
    }
}

/// One character's matching form: typographic quotes, dash variants,
/// full-width ASCII and non-breaking spaces fold to their plain ASCII
/// equivalents - the usual differences between a model's quote and the
/// author's text. One char in, one char out, so positions stay aligned
/// (src/ai/doc-markdown.ts's normalizeForMatch mirrors this exactly).
pub(crate) fn normalize_char(c: char) -> char {
    match c {
        '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{2032}' => '\'',
        '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{2033}' => '"',
        '\u{2010}'..='\u{2015}' | '\u{2212}' => '-',
        '\u{00A0}' | '\u{2007}' | '\u{202F}' | '\u{3000}' => ' ',
        '\u{FF01}'..='\u{FF5E}' => char::from_u32(c as u32 - 0xFEE0).unwrap_or(c),
        _ => c,
    }
}

fn normalize_for_match(text: &str) -> String {
    text.chars().map(normalize_char).collect()
}

fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// How many places `anchor` matches, with the same fallbacks the frontend
/// resolves proposals with (findMarkdownMatch): exact first; only when that
/// finds nothing, typographic normalization; then, also folding whitespace
/// runs (a quote that turned a blank line into one newline). Agreeing here
/// matters: when only the frontend tolerated a folded blank line, the model
/// was told "no match", retried, and the user got the edit twice.
/// Whether `anchor` picks out one place in the document - directly, or, when
/// it repeats, through `context` (a longer verbatim quote containing it that
/// occurs once; the frontend resolves it the same way). The error is the
/// tool result that tells the model how to fix its quote.
fn check_anchor(document: &str, args: &serde_json::Value, anchor: &str) -> Result<(), String> {
    match anchor_match_count(document, anchor) {
        0 => Err("No exact match for `anchor` in the document. Quote it exactly as it appears, including punctuation and whitespace.".to_string()),
        1 => Ok(()),
        n => {
            let context = args.get("context").and_then(|v| v.as_str()).unwrap_or("");
            if context.contains(anchor)
                && context.len() > anchor.len()
                && anchor_match_count(document, context) == 1
            {
                Ok(())
            } else {
                Err(format!("`anchor` appears {n} times in the document. Add `context`: a longer quote copied verbatim from the document that contains this anchor and itself occurs exactly once (or extend the anchor)."))
            }
        }
    }
}

fn anchor_match_count(document: &str, anchor: &str) -> usize {
    let exact = document.matches(anchor).count();
    if exact > 0 {
        return exact;
    }
    let (doc, needle) = (normalize_for_match(document), normalize_for_match(anchor));
    let normalized = doc.matches(needle.as_str()).count();
    if normalized > 0 || needle.split_whitespace().count() < 2 {
        return normalized;
    }
    collapse_whitespace(&doc)
        .matches(collapse_whitespace(&needle).as_str())
        .count()
}

const ADD_COMMENT_TOOL_NAME: &str = "add_comment";

/// Feedback pinned to a passage instead of an edit to it - for "what's weak
/// here", "review this draft". Changes nothing; the anchor is validated
/// like propose_edit's so the card's "locate" button lands on it.
fn add_comment(ctx: &ToolContext, arguments: &str) -> String {
    let parsed: serde_json::Value = serde_json::from_str(arguments).unwrap_or_default();
    let anchor = parsed.get("anchor").and_then(|v| v.as_str()).unwrap_or("");
    let comment = parsed.get("comment").and_then(|v| v.as_str()).unwrap_or("");
    if comment.trim().is_empty() {
        return "`comment` is required - the feedback itself.".to_string();
    }
    if anchor.is_empty() {
        return "`anchor` is required - the exact document text the comment is about.".to_string();
    }
    match check_anchor(ctx.document, &parsed, anchor) {
        Ok(()) => "Comment added - the user sees it with a button that jumps to the passage. Don't repeat it in your reply.".to_string(),
        Err(problem) => problem,
    }
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

/// How much of the project the listing shows: enough for reference
/// material next to the document, small enough that a huge folder can't
/// blow up the prompt.
const MAX_LISTED_FILES: usize = 200;
const SEARCH_FILES_TOOL_NAME: &str = "search_files";

/// The project folder's text files (paths relative to it). Hidden entries
/// and build/dependency folders are skipped - see ai::project.
fn list_files(ctx: &ToolContext, _arguments: &str) -> String {
    let Some(root) = ctx.root else {
        return "There is no project folder for this document yet (it isn't saved), so there are no files to list."
            .to_string();
    };
    let files = crate::ai::project::walk_text_files(root);
    if files.is_empty() {
        return "The project folder has no text files.".to_string();
    }
    let mut lines: Vec<String> = files.iter().take(MAX_LISTED_FILES).cloned().collect();
    if files.len() > MAX_LISTED_FILES {
        lines.push(format!(
            "... ({} more - use search_files to find something specific)",
            files.len() - MAX_LISTED_FILES
        ));
    }
    lines.join("\n")
}

fn path_argument(arguments: &str, key: &str) -> String {
    serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|v| v.get(key).and_then(|p| p.as_str()).map(str::to_string))
        .unwrap_or_default()
}

/// Reads a text file from inside the project folder - containment, hidden
/// files and size are enforced by ai::project::read_text.
fn read_file(ctx: &ToolContext, arguments: &str) -> String {
    let Some(root) = ctx.root else {
        return "There is no project folder for this document yet (it isn't saved), so there are no files to read."
            .to_string();
    };
    crate::ai::project::read_text(root, &path_argument(arguments, "path")).unwrap_or_else(|err| err)
}

/// Finds which project files mention something - the cross-file companion
/// to search_document.
fn search_files(ctx: &ToolContext, arguments: &str) -> String {
    let Some(root) = ctx.root else {
        return "There is no project folder for this document yet (it isn't saved), so there is nothing to search."
            .to_string();
    };
    crate::ai::project::search(root, &path_argument(arguments, "query"))
}

/// The tools available to an agent conversation. Skill and file tools are
/// only offered when there's something for them to work on - a tool that can
/// only report "nothing there" would just waste the model's steps. Append
/// here (or extend to merge in MCP-provided tools) as the toolset grows.
pub fn builtin_tools(has_skills: bool, has_root: bool, allow_edits: bool) -> Vec<Tool> {
    let mut tools = vec![Tool {
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
        }, Tool {
            spec: ToolSpec {
                name: READ_DOCUMENT_TOOL_NAME,
                description: "Read part of the current document verbatim: a whole section by its heading (subsections included), or a range of lines. Use it before revising a passage you can't fully see, and to copy exact anchors. The text comes back without line-number prefixes, ready to quote.",
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "heading": {
                            "type": "string",
                            "description": "Heading text of the section to read (case-insensitive, partial match). Takes precedence over the line range."
                        },
                        "start_line": {
                            "type": "integer",
                            "description": "First line to read, 1-based (as in the outline and search results)."
                        },
                        "end_line": {
                            "type": "integer",
                            "description": "Last line to read, inclusive."
                        }
                    },
                }),
            },
            run: read_document,
        }];

    // Comments change nothing, so every mode has them - feedback is most
    // often asked for in Ask mode.
    tools.push(Tool {
        spec: ToolSpec {
            name: ADD_COMMENT_TOOL_NAME,
            description: "Pin a piece of feedback to a passage without changing it - for reviews and critique (\"what's weak here\", \"check this draft\"). One call per point; quote the passage verbatim as `anchor` (unique in the document, or add `context`). The user sees each comment as a card that jumps to its passage, so keep your reply to a short overall summary.",
            parameters: json!({
                "type": "object",
                "properties": {
                    "anchor": {
                        "type": "string",
                        "description": "Exact document text the comment is about"
                    },
                    "comment": {
                        "type": "string",
                        "description": "The feedback, in the user's language - specific and actionable"
                    },
                    "context": {
                        "type": "string",
                        "description": "Only when `anchor` repeats: a longer verbatim quote containing it that occurs once"
                    }
                },
                "required": ["anchor", "comment"],
            }),
        },
        run: add_comment,
    });

    // Ask and Plan are structurally read-only: the model never receives the
    // edit tool, so a provider cannot accidentally ignore a prompt-only mode
    // instruction and create a proposal anyway.
    if allow_edits {
        tools.push(Tool {
            spec: ToolSpec {
                name: PROPOSE_EDIT_TOOL_NAME,
                description: "Propose one edit to the document. Nothing is modified directly: the user reviews the proposal and applies it with one click. Call once per distinct edit. Pick the action that matches the intent: `replace` swaps `anchor` for `text`; `replace_selection` swaps the user's currently selected text (the <selected-text> block in their message; no `anchor` needed) for `text`; `insert_before`/`insert_after` add `text` around an untouched `anchor` - inside the paragraph when the anchor is a phrase or sentence within it (write `text` as words that read on from it - after a paragraph's last sentence, this continues the paragraph), as a new paragraph when the anchor is a whole block or `text` is block content (a heading, list, several paragraphs), and as a new line of the same table or list when the anchor is a whole row or list item line and `text` is another one; `delete` removes `anchor`; `append` adds `text` at the end of the document; `insert_at_cursor` adds `text` exactly where the user's cursor is (only when their message carries a <cursor> block showing it; no `anchor` needed). `anchor` must be copied verbatim from the document and occur exactly once - if the text you need to target appears more than once, keep `anchor` as the exact text being edited and also pass `context`. `text` must be valid markdown: `-` or `1.` for lists (never `•` or other bullet symbols), `#` for headings.",
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
                        },
                        "context": {
                            "type": "string",
                            "description": "Only when `anchor` occurs more than once in the document: a longer quote copied verbatim from the document that contains the anchor and itself occurs exactly once - it pins down which occurrence is meant."
                        },
                        "reason": {
                            "type": "string",
                            "description": "One short sentence, in the language of your reply, on why this change - shown on the proposal card so the user can judge it at a glance (e.g. \"Cut the repeated point about cost\")."
                        }
                    },
                    "required": ["action"],
                }),
            },
            run: propose_edit,
        });
    }

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
                name: SEARCH_FILES_TOOL_NAME,
                description: "Search every text file in the project folder for a word or phrase (case-insensitive). Returns `path:line: text` matches - use it to find where a character, term or fact appears across chapters and notes, then read_file for the full context.",
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Text to search for"
                        }
                    },
                    "required": ["query"],
                }),
            },
            run: search_files,
        });
        tools.push(Tool {
            spec: ToolSpec {
                name: LIST_FILES_TOOL_NAME,
                description: "List the text files in the project folder (recursively, paths relative to it). Use it to discover reference material - notes, other chapters, data - before reading one.",
                parameters: json!({"type": "object", "properties": {}}),
            },
            run: list_files,
        });
        tools.push(Tool {
            spec: ToolSpec {
                name: READ_FILE_TOOL_NAME,
                description: "Read a text file from the project folder. Use the relative path as shown by list_files or search_files.",
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path relative to the project folder"
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchors_match_through_typography_and_folded_whitespace() {
        let doc = "He said “hello” — twice.\n\nThen left；quietly.";
        assert_eq!(anchor_match_count(doc, "He said \"hello\" - twice."), 1);
        assert_eq!(anchor_match_count(doc, "Then left;quietly."), 1);
        assert_eq!(anchor_match_count(doc, "twice.\nThen left"), 1);
        assert_eq!(anchor_match_count(doc, "not here"), 0);
    }

    #[test]
    fn a_section_runs_to_the_next_heading_at_its_level() {
        let doc = "# Intro\na\n## Intro details\nb\n# Methods\nc\n```sh\n# not a heading\n```";
        let lines: Vec<&str> = doc.lines().collect();
        // Exact title beats a heading that merely contains it.
        assert_eq!(section_range(&lines, "Intro"), Some((0, 4)));
        assert_eq!(section_range(&lines, "## intro DETAILS"), Some((2, 4)));
        // A `#` comment in a fence doesn't end the last section.
        assert_eq!(section_range(&lines, "methods"), Some((4, 9)));
        assert_eq!(section_range(&lines, "Results"), None);
        assert_eq!(section_range(&lines, "  "), None);
    }

    #[test]
    fn a_repeated_anchor_needs_a_longer_unique_context() {
        let doc = "the cat sat. the dog sat.";
        let args = |context: &str| serde_json::json!({ "context": context });
        assert!(check_anchor(doc, &args(""), "the cat").is_ok());
        assert!(check_anchor(doc, &args(""), "sat.").is_err());
        assert!(check_anchor(doc, &args("dog sat."), "sat.").is_ok());
        // The context must be longer than the anchor and occur once.
        assert!(check_anchor(doc, &args("sat."), "sat.").is_err());
        assert!(check_anchor(doc, &args("missing sat."), "sat.").is_err());
    }

    fn ctx(document: &str) -> ToolContext<'_> {
        ToolContext {
            document,
            skills: &[],
            root: None,
        }
    }

    #[test]
    fn read_document_reads_a_section_with_its_subsections() {
        let doc = "# Title\nintro\n## Methods\nm1\n### Sampling\ns1\n```\n# not a heading\n```\n## Results\nr1";
        let out = read_document(&ctx(doc), r#"{"heading":"methods"}"#);
        assert!(out.starts_with("Lines 3-9 of 11:"), "{out}");
        assert!(out.contains("### Sampling") && out.contains("# not a heading"));
        assert!(!out.contains("## Results"));
    }

    #[test]
    fn read_document_reads_an_inclusive_line_range() {
        let out = read_document(&ctx("a\nb\nc\nd"), r#"{"start_line":2,"end_line":3}"#);
        assert_eq!(out, "Lines 2-3 of 4:\nb\nc\n");
    }

    #[test]
    fn read_only_modes_do_not_receive_the_edit_tool() {
        let read_only = builtin_tools(true, true, false);
        assert!(!read_only
            .iter()
            .any(|tool| tool.spec.name == PROPOSE_EDIT_TOOL_NAME));

        let editing = builtin_tools(true, true, true);
        assert!(editing
            .iter()
            .any(|tool| tool.spec.name == PROPOSE_EDIT_TOOL_NAME));
    }

    #[test]
    fn propose_edit_rejects_repeated_anchor_without_context() {
        let out = propose_edit(
            &ctx("Levis is great. Levis is fast."),
            r#"{"action":"replace","anchor":"Levis","text":"It"}"#,
        );
        assert!(out.contains("appears 2 times"), "{out}");
        assert!(out.contains("`context`"), "{out}");
    }

    #[test]
    fn propose_edit_accepts_repeated_anchor_with_unique_context() {
        let out = propose_edit(
            &ctx("Levis is great. Levis is fast."),
            r#"{"action":"replace","anchor":"Levis","text":"It","context":"Levis is fast"}"#,
        );
        assert!(out.starts_with("Edit proposed"), "{out}");
    }

    #[test]
    fn propose_edit_rejects_context_that_repeats_or_misses_the_anchor() {
        let doc = "Levis is great. Levis is great.";
        let repeated = propose_edit(
            &ctx(doc),
            r#"{"action":"replace","anchor":"Levis","text":"It","context":"Levis is great"}"#,
        );
        assert!(repeated.contains("`context`"), "{repeated}");
        let anchor_free = propose_edit(
            &ctx("Levis is great. Levis is fast."),
            r#"{"action":"replace","anchor":"Levis","text":"It","context":"is fast"}"#,
        );
        assert!(anchor_free.contains("`context`"), "{anchor_free}");
    }
}
