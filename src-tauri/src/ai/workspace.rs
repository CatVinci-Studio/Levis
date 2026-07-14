use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// The agent workspace: per-folder AI configuration for the document being
/// edited, layered over a global one.
///
/// A workspace is the folder containing the current document, configured by
/// a `.levis/` directory inside it:
///
/// ```text
/// my-novel/
/// ├── chapter-1.md          <- the open document
/// └── .levis/
///     ├── agent.md          <- workspace instructions (always in the system prompt)
///     └── skills/
///         └── polish.md     <- one skill per file: YAML frontmatter + prompt body
/// ```
///
/// The global layer lives in the app config dir under `agent/` with the same
/// shape and applies to every document; a workspace skill with the same name
/// shadows the global one. Skill files are markdown with a frontmatter block:
///
/// ```text
/// ---
/// name: polish
/// description: Tighten prose without changing meaning
/// ---
/// (full instructions the model loads on demand)
/// ```
///
/// Only `name` + `description` go into the system prompt (the skill index);
/// the body is loaded dynamically via the `use_skill` tool.
pub const WORKSPACE_DIR_NAME: &str = ".levis";

#[derive(Serialize, Clone)]
pub struct AgentSkill {
    pub name: String,
    pub description: String,
    pub prompt: String,
}

#[derive(Serialize, Clone, Default)]
pub struct AgentWorkspace {
    /// Global then workspace agent.md contents, in prompt order.
    pub instructions: Vec<String>,
    /// Merged skills, workspace shadowing global on name collisions.
    pub skills: Vec<AgentSkill>,
    /// The folder containing the document, when it has one - the sandbox
    /// root for the agent's file tools.
    pub root: Option<String>,
}

fn global_agent_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string()).map(|p| p.join("agent"))
}

/// Splits a skill file into (frontmatter fields, body). The frontmatter is
/// intentionally parsed by hand - it's two known string fields, not worth a
/// YAML dependency. A file without frontmatter is still a valid skill: the
/// file stem becomes its name and the whole file its prompt.
fn parse_skill_file(file_stem: &str, content: &str) -> AgentSkill {
    let mut name = file_stem.to_string();
    let mut description = String::new();
    let mut body = content;

    if let Some(rest) = content.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let frontmatter = &rest[..end];
            body = rest[end + 4..].trim_start_matches(['\r', '\n']);
            for line in frontmatter.lines() {
                let Some((key, value)) = line.split_once(':') else { continue };
                let value = value.trim().trim_matches('"').trim_matches('\'');
                match key.trim() {
                    "name" => {
                        if !value.is_empty() {
                            name = value.split_whitespace().collect::<Vec<_>>().join("-");
                        }
                    }
                    "description" => description = value.to_string(),
                    _ => {}
                }
            }
        }
    }

    AgentSkill {
        name,
        description,
        prompt: body.trim().to_string(),
    }
}

/// Reads one layer (global dir or a workspace's .levis dir): its agent.md
/// and every skill under skills/. Missing files/dirs are just empty layers,
/// never errors - most folders won't have any configuration.
fn read_layer(dir: &Path) -> (Option<String>, Vec<AgentSkill>) {
    let instructions = std::fs::read_to_string(dir.join("agent.md"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let mut skills = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir.join("skills")) {
        let mut paths: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("md"))
            .collect();
        paths.sort();
        for path in paths {
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { continue };
            let Ok(content) = std::fs::read_to_string(&path) else { continue };
            let skill = parse_skill_file(stem, &content);
            if !skill.prompt.is_empty() {
                skills.push(skill);
            }
        }
    }

    (instructions, skills)
}

/// Loads the merged agent workspace for a document: global layer first,
/// then the document folder's `.levis/` layer on top.
pub fn load(app: &AppHandle, doc_path: Option<&str>) -> AgentWorkspace {
    let mut ws = AgentWorkspace::default();

    if let Ok(global_dir) = global_agent_dir(app) {
        let (instructions, skills) = read_layer(&global_dir);
        ws.instructions.extend(instructions);
        ws.skills.extend(skills);
    }

    let root = doc_path
        .map(Path::new)
        .and_then(|p| p.parent())
        .filter(|p| !p.as_os_str().is_empty());
    if let Some(root) = root {
        ws.root = Some(root.to_string_lossy().to_string());
        let (instructions, skills) = read_layer(&root.join(WORKSPACE_DIR_NAME));
        ws.instructions.extend(instructions);
        // Workspace skills shadow same-named global ones.
        for skill in skills {
            ws.skills.retain(|s| s.name != skill.name);
            ws.skills.push(skill);
        }
    }

    ws
}

/// The workspace as the frontend needs it: the skill list for the `/name`
/// picker in the chat input. Loaded fresh each time the chat opens so file
/// edits are picked up without restarting.
#[tauri::command]
pub async fn load_agent_workspace(app: AppHandle, doc_path: Option<String>) -> AgentWorkspace {
    tauri::async_runtime::spawn_blocking(move || load(&app, doc_path.as_deref()))
        .await
        .unwrap_or_default()
}

/// Creates the global agent directory (with a starter agent.md and skills/
/// folder on first use) and reveals it in the file manager - the Settings
/// "open folder" button.
#[tauri::command]
pub async fn open_global_agent_dir(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let dir = global_agent_dir(&app)?;
    let skills = dir.join("skills");
    std::fs::create_dir_all(&skills).map_err(|e| e.to_string())?;

    let agent_md = dir.join("agent.md");
    if !agent_md.exists() {
        std::fs::write(
            &agent_md,
            "<!-- Instructions here are added to every AI chat (all documents). -->\n",
        )
        .map_err(|e| e.to_string())?;
    }

    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_frontmatter_skill() {
        let skill = parse_skill_file(
            "polish",
            "---\nname: tighten\ndescription: Tighten prose\n---\nRewrite the text to be tighter.",
        );
        assert_eq!(skill.name, "tighten");
        assert_eq!(skill.description, "Tighten prose");
        assert_eq!(skill.prompt, "Rewrite the text to be tighter.");
    }

    #[test]
    fn skill_without_frontmatter_uses_file_stem() {
        let skill = parse_skill_file("outline", "Make an outline of the document.");
        assert_eq!(skill.name, "outline");
        assert_eq!(skill.description, "");
        assert_eq!(skill.prompt, "Make an outline of the document.");
    }

    #[test]
    fn skill_name_with_spaces_is_slugged() {
        // /name invocation can't contain spaces - collapse them so the
        // picker and use_skill lookups agree on one token.
        let skill = parse_skill_file("x", "---\nname: fix my prose\n---\nbody");
        assert_eq!(skill.name, "fix-my-prose");
    }
}
