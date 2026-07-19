use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

/// Pandoc-backed export follows Typora's model: detect a user-installed
/// binary instead of bundling one (pandoc is ~180MB and GPL-licensed; the
/// frontend guides the user to pandoc.org when it's missing).
fn pandoc_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![
        // Works when the app inherits a shell PATH (e.g. launched via CLI).
        PathBuf::from("pandoc"),
        PathBuf::from("/opt/homebrew/bin/pandoc"),
        PathBuf::from("/usr/local/bin/pandoc"),
        PathBuf::from("/opt/local/bin/pandoc"),
        PathBuf::from("/usr/bin/pandoc"),
    ];
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(home).join(".local/bin/pandoc"));
    }
    candidates
}

/// Returns the path of a working pandoc binary, or None. GUI apps launched
/// from Finder don't inherit the shell's PATH, so beyond a plain `pandoc`
/// lookup this probes the usual install locations (Homebrew, MacPorts, the
/// official installer's /usr/local, ~/.local).
#[tauri::command]
pub async fn detect_pandoc() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        for candidate in pandoc_candidates() {
            let works = Command::new(&candidate)
                .arg("--version")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if works {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        None
    })
    .await
    .ok()
    .flatten()
}

/// Converts the current document text to `format` (a pandoc writer name)
/// via a user-installed pandoc. The markdown is piped through stdin - no
/// temp file - and --resource-path points at the document's folder so
/// relative image srcs (Typora-style assets/...) resolve for formats that
/// embed them (docx, epub, odt).
#[tauri::command]
pub async fn export_via_pandoc(
    pandoc_path: String,
    markdown: String,
    output_path: String,
    format: String,
    resource_dir: Option<String>,
    title: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&pandoc_path);
        cmd.arg("--from")
            // gfm to match the editor's dialect; dollar math and YAML
            // frontmatter are off by default in pandoc's gfm reader but
            // supported in Levis documents.
            .arg("gfm+tex_math_dollars+yaml_metadata_block")
            .arg("--to")
            .arg(&format)
            .arg("--standalone")
            // epub refuses (and standalone latex warns) without a title;
            // the filename stem is what Typora passes too.
            .arg("--metadata")
            .arg(format!("title={title}"))
            .arg("--output")
            .arg(&output_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        if let Some(dir) = &resource_dir {
            cmd.arg("--resource-path").arg(dir);
            cmd.current_dir(dir);
        }
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        child
            .stdin
            .take()
            .ok_or_else(|| "failed to open pandoc stdin".to_string())?
            .write_all(markdown.as_bytes())
            .map_err(|e| e.to_string())?;
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Save dialog for exports - like save_file_dialog but with the target
/// format's name and extension.
#[tauri::command]
pub async fn export_save_dialog(
    app: tauri::AppHandle,
    default_name: String,
    filter_name: String,
    ext: String,
) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(&default_name)
            .add_filter(&filter_name, &[ext.as_str()])
            .blocking_save_file()
            .map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub async fn open_pandoc_install_page(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url("https://pandoc.org/installing.html", None::<&str>)
        .map_err(|e| e.to_string())
}

/// Shows the exported file in Finder, so a successful export has visible
/// feedback beyond the dialog closing.
#[tauri::command]
pub async fn reveal_in_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}
