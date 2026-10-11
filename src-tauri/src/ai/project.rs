//! The project folder: the agent workspace root seen as writing material.
//! One place for walking it, reading from it safely, searching it, and the
//! two writing aids that live in its `.levis/` directory:
//!
//! ```text
//! my-novel/
//! ├── chapter-1.md
//! └── .levis/
//!     ├── style.md            <- the author's style profile ("Learn my style")
//!     └── library/
//!         ├── lin-wan.md      <- one entry per character, place or term
//!         └── harbour-city.md
//! ```
//!
//! A library entry is markdown with an optional frontmatter block:
//!
//! ```text
//! ---
//! name: Lin Wan
//! aliases: [Wan, Ms Lin]
//! include: detected        # always | detected (default) | never
//! ---
//! Protagonist, 32, teaches Chinese at a secondary school...
//! ```
//!
//! Entries go to the model only when they matter: `always`, or `detected` -
//! the name or an alias appears in what the request is about. Undetected
//! entries cost nothing, so a large library stays cheap.

use crate::ai::workspace::WORKSPACE_DIR_NAME;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Directories that are never writing material: build output, dependency
/// trees, version control. Skipping them keeps a project folder that also
/// holds code from drowning every listing.
const SKIPPED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "__pycache__",
    "venv",
    ".venv",
];

/// Extensions read as text by listing, search and @-mentions.
const TEXT_EXTENSIONS: &[&str] = &[
    "md", "markdown", "txt", "text", "rst", "org", "tex", "csv", "tsv", "json", "yaml", "yml",
    "toml", "html", "htm", "xml",
];

const MAX_FILE_BYTES: u64 = 100 * 1024;
const MAX_WALKED_FILES: usize = 2000;
const MAX_SEARCH_MATCHES: usize = 40;
const MAX_LIBRARY_CHARS: usize = 8_000;
const MAX_STYLE_CHARS: usize = 6_000;

/// A folder too broad to hand to the agent as a project: the filesystem
/// root or the home directory. Everything under it would be one guessed
/// path away from the provider.
pub fn is_too_broad(path: &Path) -> bool {
    let canon = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if canon.parent().is_none() {
        return true;
    }
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .and_then(|home| home.canonicalize().ok())
        .is_some_and(|home| home == canon)
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

fn is_text_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| TEXT_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Every text file under `root` (relative paths, sorted, depth-first),
/// skipping hidden entries and SKIPPED_DIRS. Bounded: a huge tree stops at
/// MAX_WALKED_FILES rather than stalling the request.
pub fn walk_text_files(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        paths.sort();
        // Reverse so the stack pops subfolders in name order.
        let mut subdirs = Vec::new();
        for path in paths {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            if is_hidden(name) {
                continue;
            }
            if path.is_dir() {
                if !SKIPPED_DIRS.contains(&name) {
                    subdirs.push(path);
                }
            } else if is_text_file(&path) {
                if let Ok(rel) = path.strip_prefix(root) {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                }
                if out.len() >= MAX_WALKED_FILES {
                    return out;
                }
            }
        }
        pending.extend(subdirs.into_iter().rev());
    }
    out
}

/// Reads `rel` from inside `root`: canonical containment (no `..`, absolute
/// paths or symlinks out), no hidden components, text only, size-capped.
pub fn read_text(root: &Path, rel: &str) -> Result<String, String> {
    let rel = rel.trim().trim_start_matches('@');
    if rel.is_empty() {
        return Err("No path provided.".to_string());
    }
    let (Ok(root_canon), Ok(path)) = (root.canonicalize(), root.join(rel).canonicalize()) else {
        return Err(format!(
            "`{rel}` doesn't exist. Use list_files to see what's available."
        ));
    };
    if !path.starts_with(&root_canon) {
        return Err(
            "That path is outside the project folder - only files inside it can be read."
                .to_string(),
        );
    }
    // list_files never shows hidden entries, and nothing a writing task needs
    // lives in them - but a project in ~ would otherwise put .ssh, .env or
    // .aws/credentials one guessed path (or one injected instruction) away
    // from being sent to the provider.
    let hidden = path
        .strip_prefix(&root_canon)
        .unwrap_or(&path)
        .components()
        .any(|c| is_hidden(&c.as_os_str().to_string_lossy()));
    if hidden {
        return Err(
            "Hidden files and folders (names starting with \".\") can't be read.".to_string(),
        );
    }
    match std::fs::metadata(&path) {
        Ok(meta) if meta.is_dir() => Err(format!("`{rel}` is a folder, not a file.")),
        Ok(meta) if meta.len() > MAX_FILE_BYTES => Err(format!(
            "`{rel}` is too large to read ({} KB; the limit is {} KB).",
            meta.len() / 1024,
            MAX_FILE_BYTES / 1024
        )),
        _ => std::fs::read_to_string(&path)
            .map_err(|_| format!("`{rel}` isn't a readable text file.")),
    }
}

/// Case-insensitive line search across the project's text files, as
/// `path:line: text`. Capped so a common word can't flood the context.
pub fn search(root: &Path, query: &str) -> String {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return "No query provided.".to_string();
    }
    let mut hits = Vec::new();
    'files: for rel in walk_text_files(root) {
        let Ok(text) = read_text(root, &rel) else {
            continue;
        };
        for (i, line) in text.lines().enumerate() {
            if line.to_lowercase().contains(&needle) {
                let shown: String = line.trim().chars().take(200).collect();
                hits.push(format!("{rel}:{}: {shown}", i + 1));
                if hits.len() >= MAX_SEARCH_MATCHES {
                    hits.push(format!("... (stopped at {MAX_SEARCH_MATCHES} matches)"));
                    break 'files;
                }
            }
        }
    }
    if hits.is_empty() {
        format!("No matches for \"{query}\" in the project folder.")
    } else {
        hits.join("\n")
    }
}

// ------------------------------------------------------------- style + library

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum LibraryInclude {
    Always,
    Detected,
    Never,
}

#[derive(Serialize, Clone, Debug)]
pub struct LibraryEntry {
    pub name: String,
    pub aliases: Vec<String>,
    pub include: LibraryInclude,
    /// Path relative to the project root, for "open this entry".
    pub file: String,
    pub body: String,
}

fn parse_list(value: &str) -> Vec<String> {
    value
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split([',', '，', '、'])
        .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

pub fn parse_library_entry(file: &str, stem: &str, content: &str) -> LibraryEntry {
    let mut entry = LibraryEntry {
        name: stem.to_string(),
        aliases: Vec::new(),
        include: LibraryInclude::Detected,
        file: file.to_string(),
        body: content.trim().to_string(),
    };
    if let Some(rest) = content.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            for line in rest[..end].lines() {
                let Some((key, value)) = line.split_once(':') else {
                    continue;
                };
                let value = value.trim();
                match key.trim() {
                    "name" if !value.is_empty() => {
                        entry.name = value.trim_matches('"').trim_matches('\'').to_string()
                    }
                    "aliases" => entry.aliases = parse_list(value),
                    "include" => {
                        entry.include = match value.trim_matches('"') {
                            "always" => LibraryInclude::Always,
                            "never" => LibraryInclude::Never,
                            _ => LibraryInclude::Detected,
                        }
                    }
                    _ => {}
                }
            }
            entry.body = rest[end + 4..].trim().to_string();
        }
    }
    entry
}

pub fn read_library(root: &Path) -> Vec<LibraryEntry> {
    let dir = root.join(WORKSPACE_DIR_NAME).join("library");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("md"))
        .collect();
    paths.sort();
    paths
        .into_iter()
        .filter_map(|path| {
            let stem = path.file_stem()?.to_str()?.to_string();
            let content = std::fs::read_to_string(&path).ok()?;
            let file = format!("{WORKSPACE_DIR_NAME}/library/{stem}.md");
            let entry = parse_library_entry(&file, &stem, &content);
            (!entry.body.is_empty()).then_some(entry)
        })
        .collect()
}

fn style_path(root: &Path) -> PathBuf {
    root.join(WORKSPACE_DIR_NAME).join("style.md")
}

pub fn read_style(root: &Path) -> Option<String> {
    std::fs::read_to_string(style_path(root))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(MAX_STYLE_CHARS).collect())
}

/// The library entries a request should carry: `always` ones, plus
/// `detected` ones whose name or an alias appears in `context` (the user's
/// message, the selection, the text around the cursor). Bounded overall.
pub fn relevant_library<'a>(library: &'a [LibraryEntry], context: &str) -> Vec<&'a LibraryEntry> {
    let haystack = context.to_lowercase();
    let mut picked = Vec::new();
    let mut used = 0;
    for entry in library {
        let hit = match entry.include {
            LibraryInclude::Always => true,
            LibraryInclude::Never => false,
            LibraryInclude::Detected => std::iter::once(&entry.name)
                .chain(entry.aliases.iter())
                .filter(|term| term.chars().count() >= 2)
                .any(|term| haystack.contains(&term.to_lowercase())),
        };
        if hit && used + entry.body.len() <= MAX_LIBRARY_CHARS {
            used += entry.body.len();
            picked.push(entry);
        }
    }
    picked
}

/// The prompt section for the style profile and the relevant library
/// entries - shared by the agent and the inline completion.
pub fn writing_context_section(style: Option<&str>, entries: &[&LibraryEntry]) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(style) = style {
        parts.push(format!(
            "---the author's style profile (follow it when writing for this project)---\n{style}"
        ));
    }
    if !entries.is_empty() {
        let body = entries
            .iter()
            .map(|e| {
                let aka = if e.aliases.is_empty() {
                    String::new()
                } else {
                    format!(" (also: {})", e.aliases.join(", "))
                };
                format!("## {}{aka}\n{}", e.name, e.body)
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        parts.push(format!(
            "---project library: established facts about the people, places and terms mentioned here - stay consistent with them---\n{body}"
        ));
    }
    (!parts.is_empty()).then(|| parts.join("\n\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_entries_parse_frontmatter_lists_in_both_scripts() {
        let entry = parse_library_entry(
            ".levis/library/lin.md",
            "lin",
            "---\nname: 林晚\naliases: [晚晚, 林老师]\ninclude: always\n---\n女主角。",
        );
        assert_eq!(entry.name, "林晚");
        assert_eq!(entry.aliases, ["晚晚", "林老师"]);
        assert_eq!(entry.include, LibraryInclude::Always);
        assert_eq!(entry.body, "女主角。");
        let plain = parse_library_entry("f", "Harbour", "A port city.");
        assert_eq!(plain.name, "Harbour");
        assert_eq!(plain.include, LibraryInclude::Detected);
    }

    #[test]
    fn only_mentioned_or_always_entries_are_relevant() {
        let lib = vec![
            parse_library_entry("a", "a", "---\nname: 林晚\naliases: [晚晚]\n---\n女主角。"),
            parse_library_entry("b", "b", "---\nname: Harbour\n---\nA port."),
            parse_library_entry(
                "c",
                "c",
                "---\nname: Rules\ninclude: always\n---\nNo magic.",
            ),
            parse_library_entry("d", "d", "---\nname: Secret\ninclude: never\n---\nHidden."),
        ];
        let names: Vec<_> = relevant_library(&lib, "晚晚走进教室，Secret 不该出现")
            .iter()
            .map(|e| e.name.clone())
            .collect();
        assert_eq!(names, ["林晚", "Rules"]);
    }

    #[test]
    fn walking_skips_hidden_and_build_folders_and_reads_safely() {
        let dir = std::env::temp_dir().join(format!("levis-project-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for (path, body) in [
            ("notes/a.md", "alpha beta"),
            ("b.txt", "Beta gamma"),
            (".secret/key.md", "beta"),
            ("node_modules/x.md", "beta"),
            ("image.png", "beta"),
        ] {
            let full = dir.join(path);
            std::fs::create_dir_all(full.parent().unwrap()).unwrap();
            std::fs::write(full, body).unwrap();
        }
        assert_eq!(walk_text_files(&dir), ["b.txt", "notes/a.md"]);
        let found = search(&dir, "beta");
        assert!(found.contains("b.txt:1:") && found.contains("notes/a.md:1:"));
        assert!(!found.contains(".secret") && !found.contains("node_modules"));
        assert!(read_text(&dir, ".secret/key.md").is_err());
        assert!(read_text(&dir, "../etc/passwd").is_err());
        assert_eq!(read_text(&dir, "@notes/a.md").unwrap(), "alpha beta");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn filesystem_root_is_too_broad() {
        assert!(is_too_broad(Path::new("/")));
        assert!(!is_too_broad(
            &std::env::temp_dir().join("levis-some-project")
        ));
    }
}

// ------------------------------------------------------------------ commands

fn project_root(doc_path: Option<&str>, workspace_root: Option<&str>) -> Result<PathBuf, String> {
    crate::ai::workspace::project_root(doc_path, workspace_root)
        .ok_or_else(|| "NO_PROJECT".to_string())
}

/// The project's text files, for the composer's @-mention picker.
#[tauri::command]
pub async fn list_project_files(
    doc_path: Option<String>,
    workspace_root: Option<String>,
) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_root(doc_path.as_deref(), workspace_root.as_deref())
            .map(|root| walk_text_files(&root))
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default()
}

/// One project file's text, for an @-mention - the same safety rules as the
/// agent's read_file tool.
#[tauri::command]
pub async fn read_project_file(
    doc_path: Option<String>,
    workspace_root: Option<String>,
    path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = project_root(doc_path.as_deref(), workspace_root.as_deref())?;
        read_text(&root, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Creates `.levis/<rel>` with `template` unless it already exists, and
/// returns its absolute path - "new library entry", "open style profile".
#[tauri::command]
pub async fn ensure_project_file(
    doc_path: Option<String>,
    workspace_root: Option<String>,
    rel: String,
    template: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = project_root(doc_path.as_deref(), workspace_root.as_deref())?;
        let rel = rel.trim_start_matches(['/', '\\']);
        if rel
            .split(['/', '\\'])
            .any(|part| part == ".." || part.is_empty())
        {
            return Err("Invalid file name.".to_string());
        }
        let path = root.join(WORKSPACE_DIR_NAME).join(rel);
        if !path.exists() {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&path, template).map_err(|e| e.to_string())?;
        }
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Multi-select picker for the writing samples "Learn my style" analyses.
#[tauri::command]
pub async fn pick_text_files(window: tauri::WebviewWindow) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::commands::fs::window_file_dialog(&window)
            .add_filter("Text", &["md", "markdown", "txt"])
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|p| p.to_string())
            .collect()
    })
    .await
    .unwrap_or_default()
}

const STYLE_SAMPLE_CHARS: usize = 20_000;
const STYLE_TOTAL_CHARS: usize = 60_000;

const STYLE_INSTRUCTIONS: &str = "You analyse an author's writing so that an AI writing assistant can continue and revise their text in their own voice. You are given samples the author picked as representative. Write a style profile in Markdown, in the same language as the samples, with exactly these sections:\n\n# Style profile\n\n## Voice and tone\n## Sentences and rhythm\n## Word choice\n## Punctuation and formatting\n## Structure\n## Never\n## Examples\n\nUnder each heading give 3-6 short, concrete, checkable bullet points drawn from the samples (\"opens paragraphs with a concrete scene, then the claim\", \"average sentence 12-18 characters, many one-clause sentences\", \"uses full-width Chinese punctuation, no em dashes\") - not generic praise or advice. 'Never' lists things this author clearly avoids. 'Examples' quotes 2-3 short representative passages (1-3 sentences each) verbatim from the samples. Output only the profile.";

/// "Learn my style": analyses the picked samples and writes the project's
/// `.levis/style.md` (keeping the previous one as style.previous.md), which
/// the agent and the inline completion then follow. Returns its path, which
/// the frontend opens for the author to review and edit.
#[tauri::command]
pub async fn learn_style(
    app: tauri::AppHandle,
    provider: String,
    model: Option<String>,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    files: Vec<String>,
) -> Result<String, String> {
    let (root, samples) = {
        tauri::async_runtime::spawn_blocking(move || -> Result<(PathBuf, String), String> {
            let root = project_root(doc_path.as_deref(), workspace_root.as_deref())?;
            let mut samples = String::new();
            for file in files.iter().take(8) {
                if samples.chars().count() >= STYLE_TOTAL_CHARS {
                    break;
                }
                let Ok(text) = std::fs::read_to_string(file) else {
                    continue;
                };
                let name = Path::new(file)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let excerpt: String = text.chars().take(STYLE_SAMPLE_CHARS).collect();
                samples.push_str(&format!(
                    "<sample name=\"{name}\">\n{excerpt}\n</sample>\n\n"
                ));
            }
            if samples.trim().is_empty() {
                return Err("NO_SAMPLES".to_string());
            }
            Ok((root, samples))
        })
        .await
        .map_err(|e| e.to_string())??
    };
    let profile = crate::ai::client::call(
        &app,
        &provider,
        STYLE_INSTRUCTIONS.to_string(),
        samples,
        model.as_deref(),
    )
    .await?;
    let profile = profile.trim();
    if profile.is_empty() {
        return Err("The model returned an empty profile.".to_string());
    }
    let path = style_path(&root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if path.exists() {
        let _ = std::fs::copy(&path, path.with_file_name("style.previous.md"));
    }
    std::fs::write(&path, format!("{profile}\n")).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
