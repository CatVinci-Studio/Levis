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

/// Strips `<!-- -->` comments from agent.md content before it goes anywhere
/// near a prompt: the starter template is written entirely in comments, and
/// users get a natural way to annotate their instructions. An unterminated
/// comment swallows the rest of the file, matching how HTML would parse it.
fn strip_html_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("<!--") {
        out.push_str(&rest[..start]);
        match rest[start..].find("-->") {
            Some(end) => rest = &rest[start + end + 3..],
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

/// Reads one layer (global dir or a workspace's .levis dir): its agent.md
/// and every skill under skills/. Missing files/dirs are just empty layers,
/// never errors - most folders won't have any configuration.
fn read_layer(dir: &Path) -> (Option<String>, Vec<AgentSkill>) {
    let instructions = std::fs::read_to_string(dir.join("agent.md"))
        .ok()
        .map(|s| strip_html_comments(&s).trim().to_string())
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
pub async fn open_global_agent_dir(app: AppHandle, lang: Option<String>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let dir = ensure_global_layer(&app, lang.as_deref())?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Creates the global agent dir if needed (skills/ folder plus a starter
/// agent.md, same shape `open_global_agent_dir` guarantees) and returns the
/// agent.md path. Backs the Settings "edit system prompt" button, which
/// opens that file in the editor itself - Levis IS a markdown editor, so
/// there's no bespoke textarea for it.
#[tauri::command]
pub fn ensure_global_agent_md(app: AppHandle, lang: Option<String>) -> Result<String, String> {
    Ok(ensure_global_layer(&app, lang.as_deref())?
        .join("agent.md")
        .to_string_lossy()
        .to_string())
}

/// The starter agent.md: a how-to written entirely in HTML comments, which
/// `read_layer` strips before anything reaches the model - so the template
/// teaches without polluting the system prompt, and users can keep using
/// comments to annotate their own instructions. One per UI language; the
/// frontend passes its language setting along (Rust can't read it itself).
const AGENT_MD_TEMPLATE_EN: &str = "\
<!--
This file customizes the AI chat agent (Settings > Agent).

Everything OUTSIDE comment blocks like this one is added to every
conversation's system prompt, for all documents. Comments are stripped
and never sent to the model, so this guide is safe to keep.

Things worth writing here:

  Style        e.g.  Prefer short sentences. Avoid business jargon.
  Language     e.g.  Always reply in Chinese.
  Terminology  e.g.  The product is spelled \"Levis\", never \"levis\".
  Background   e.g.  I am writing a sci-fi novel; the narrator is Mira.

Per-project instructions: put a .levis/agent.md next to your documents -
it is layered on top of this global file for those documents only.
Reusable skills go in skills/*.md (invoked with /name in the chat).
-->
";

const AGENT_MD_TEMPLATE_ZH: &str = "\
<!--
这个文件用于定制 AI 对话 Agent（设置 > Agent）。

写在注释块（比如这一段）之外的所有内容，都会加入每次对话的系统
提示词，对所有文档生效。注释会被剥离、永远不会发给模型，所以这
份说明可以一直留着。

适合写在这里的内容：

  文风    例如：多用短句，避免商业行话。
  语言    例如：始终用中文回复。
  术语    例如：产品名写作 “Levis”，不要写成 “levis”。
  背景    例如：我在写一部科幻小说，叙述者叫 Mira。

按项目定制：在文档旁边放一个 .levis/agent.md——它会叠加在这份
全局文件之上，只对那个文件夹里的文档生效。
可复用的 skill 放在 skills/*.md（在对话里用 /名字 调用）。
-->
";

const AGENT_MD_TEMPLATE_JA: &str = "\
<!--
このファイルはAIチャットAgent（設定 > Agent）をカスタマイズします。

このようなコメントブロックの外に書かれた内容は、すべての文書に
ついて、すべての会話のシステムプロンプトに追加されます。コメン
トは取り除かれ、モデルに送信されることはないので、この説明はそ
のまま残しておいて構いません。

ここに書くとよい内容：

  文体    例：短い文を好む。ビジネス用語を避ける。
  言語    例：常に日本語で返信する。
  用語    例：製品名は「Levis」と表記し、「levis」とは書かない。
  背景    例：SF小説を書いている。語り手はMira。

プロジェクトごとの指示：文書のそばに .levis/agent.md を置くと、
そのフォルダの文書にのみ、このグローバルファイルの上に重ねて適
用されます。
再利用可能なskillは skills/*.md に置きます（チャットで /名前 と
入力して呼び出します）。
-->
";

/// Guarantees the global agent dir exists with its starter files; returns
/// it. `lang` is the frontend's UI language ("zh", "ja", or anything else =
/// en), and only matters the one time the starter template is written.
fn ensure_global_layer(app: &AppHandle, lang: Option<&str>) -> Result<PathBuf, String> {
    let dir = global_agent_dir(app)?;
    std::fs::create_dir_all(dir.join("skills")).map_err(|e| e.to_string())?;
    let agent_md = dir.join("agent.md");
    if !agent_md.exists() {
        let template = match lang {
            Some("zh") => AGENT_MD_TEMPLATE_ZH,
            Some("ja") => AGENT_MD_TEMPLATE_JA,
            _ => AGENT_MD_TEMPLATE_EN,
        };
        std::fs::write(&agent_md, template).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

/// Copies a user-picked .md skill file into the global skills folder and
/// returns the refreshed global skill list (None if the dialog was
/// cancelled). The file is stored under the skill's resolved name, so
/// re-importing an updated copy replaces the old one instead of piling up.
#[tauri::command]
pub async fn import_agent_skill(app: AppHandle) -> Result<Option<Vec<AgentSkill>>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            app.dialog().file().add_filter("Markdown", &["md"]).blocking_pick_file()
        })
        .await
        .map_err(|e| e.to_string())?
    };
    let Some(src) = picked.map(|p| p.to_string()) else {
        return Ok(None);
    };

    let content = std::fs::read_to_string(&src).map_err(|e| e.to_string())?;
    let stem = Path::new(&src)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("skill")
        .to_string();
    let skill = parse_skill_file(&stem, &content);
    if skill.prompt.is_empty() {
        return Err("That file has no skill content.".to_string());
    }

    let global_dir = global_agent_dir(&app)?;
    let skills_dir = global_dir.join("skills");
    std::fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;
    std::fs::write(skills_dir.join(format!("{}.md", skill.name)), &content).map_err(|e| e.to_string())?;

    let (_, skills) = read_layer(&global_dir);
    Ok(Some(skills))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_comments_leaving_instructions() {
        let text = "<!-- how-to guide -->\nReply in Chinese.\n<!-- note to self -->";
        assert_eq!(strip_html_comments(text).trim(), "Reply in Chinese.");
    }

    #[test]
    fn comment_only_templates_yield_nothing() {
        // The starter templates must contribute zero prompt content.
        assert!(strip_html_comments(AGENT_MD_TEMPLATE_EN).trim().is_empty());
        assert!(strip_html_comments(AGENT_MD_TEMPLATE_ZH).trim().is_empty());
    }

    #[test]
    fn unterminated_comment_swallows_rest() {
        assert_eq!(strip_html_comments("keep <!-- open forever"), "keep ");
    }

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
