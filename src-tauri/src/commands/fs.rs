use serde::Serialize;
use std::path::Path;
use tokio::fs;

#[derive(Serialize)]
pub struct DirEntryInfo {
    name: String,
    path: String,
    is_dir: bool,
}

/// Opens a native file picker for a single Markdown file.
#[tauri::command]
pub async fn open_file_dialog(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Markdown", &["md", "markdown"])
            .blocking_pick_file()
            .map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten()
}

/// Opens a native file picker for a CSS theme file (e.g. a Typora-compatible
/// community theme).
#[tauri::command]
pub async fn open_css_file_dialog(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("CSS", &["css"])
            .blocking_pick_file()
            .map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten()
}

/// Opens a native "Save As" dialog for a new, never-saved document.
#[tauri::command]
pub async fn save_file_dialog(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name("未命名.md")
            .add_filter("Markdown", &["md"])
            .blocking_save_file()
            .map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten()
}

#[derive(Serialize)]
pub struct AttachedFile {
    pub name: String,
    pub content: String,
}

/// The inline chat's "+" button: pick any file and return its text content
/// for attaching to the outgoing message. Capped and text-only - attachments
/// ride inside the prompt, so a binary or huge file can't work anyway.
const MAX_ATTACHMENT_BYTES: u64 = 200 * 1024;

#[tauri::command]
pub async fn pick_attachment_file(app: tauri::AppHandle) -> Result<Option<AttachedFile>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked =
        tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_file())
            .await
            .map_err(|e| e.to_string())?;
    let Some(path) = picked.map(|p| p.to_string()) else {
        return Ok(None);
    };

    let meta = fs::metadata(&path).await.map_err(|e| e.to_string())?;
    if meta.len() > MAX_ATTACHMENT_BYTES {
        return Err(format!(
            "File is too large to attach ({} KB; the limit is {} KB).",
            meta.len() / 1024,
            MAX_ATTACHMENT_BYTES / 1024
        ));
    }
    let content = fs::read_to_string(&path)
        .await
        .map_err(|_| "Only text files can be attached.".to_string())?;
    let name = Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or(path);
    Ok(Some(AttachedFile { name, content }))
}

fn require_non_empty(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("empty path".to_string());
    }
    Ok(())
}

/// Lists the immediate children of a directory (non-recursive; the frontend
/// calls this again when a subfolder is expanded, so startup never walks the
/// whole tree). Async so a slow/network-mounted directory doesn't stall the
/// app while it's being read.
#[tauri::command]
pub async fn list_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    require_non_empty(&path)?;
    let mut reader = fs::read_dir(&path).await.map_err(|e| e.to_string())?;
    let mut items: Vec<DirEntryInfo> = Vec::new();

    while let Some(entry) = reader.next_entry().await.map_err(|e| e.to_string())? {
        let file_type = entry.file_type().await.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        items.push(DirEntryInfo {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: file_type.is_dir(),
        });
    }

    items.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(items)
}

/// Millisecond mtime of a file, or None if it doesn't exist. The frontend
/// snapshots this when a document is read or written, then compares against
/// it to detect external modifications (reload on window focus, and the
/// overwrite-conflict prompt before saving).
#[tauri::command]
pub async fn file_mtime_ms(path: String) -> Result<Option<f64>, String> {
    require_non_empty(&path)?;
    match fs::metadata(&path).await {
        Ok(meta) => {
            let modified = meta.modified().map_err(|e| e.to_string())?;
            let ms = modified
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_millis() as f64;
            Ok(Some(ms))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    require_non_empty(&path)?;
    fs::read_to_string(&path).await.map_err(|e| e.to_string())
}

/// Reads a file as base64 - used to inline a CSS theme's local font/image
/// `url(...)` assets as data URIs, since a relative path in a `<style>` tag
/// injected at runtime has no base to resolve against.
#[tauri::command]
pub async fn read_binary_file_base64(path: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    require_non_empty(&path)?;
    let bytes = fs::read(&path).await.map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(bytes))
}

#[derive(Serialize)]
pub struct SavedImage {
    /// What goes into the markdown: "assets/<name>" relative to the document,
    /// or an absolute path for a draft that has no folder yet.
    src: String,
}

/// Persists an image pasted into the editor. Saved documents get a Typora
/// style `assets/` folder next to them and a relative src; unsaved drafts
/// fall back to an assets folder in the app's data dir with an absolute src
/// (still valid after the draft is saved elsewhere).
#[tauri::command]
pub async fn save_pasted_image(
    app: tauri::AppHandle,
    doc_path: Option<String>,
    data_base64: String,
    ext: String,
) -> Result<SavedImage, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use tauri::Manager;

    if !ext.chars().all(|c| c.is_ascii_alphanumeric()) || ext.is_empty() {
        return Err("invalid extension".to_string());
    }
    let bytes = STANDARD.decode(&data_base64).map_err(|e| e.to_string())?;

    let (dir, relative) = match doc_path.as_deref().map(Path::new).and_then(|p| p.parent()) {
        Some(parent) => (parent.join("assets"), true),
        None => (
            app.path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .join("assets"),
            false,
        ),
    };
    fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let mut name = format!("image-{stamp}.{ext}");
    let mut n = 1;
    while dir.join(&name).exists() {
        name = format!("image-{stamp}-{n}.{ext}");
        n += 1;
    }
    let full = dir.join(&name);
    fs::write(&full, bytes).await.map_err(|e| e.to_string())?;

    let src = if relative {
        format!("assets/{name}")
    } else {
        full.to_string_lossy().to_string()
    };
    Ok(SavedImage { src })
}

#[derive(Serialize)]
pub struct ImageMigration {
    old: String,
    /// New "assets/<name>" src (relative to the document) on success; None
    /// if this one image failed to move - it's left at its old absolute
    /// path, so nothing is lost, just not tidied up.
    new: Option<String>,
}

async fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if fs::rename(from, to).await.is_ok() {
        return Ok(());
    }
    // rename fails across filesystems/volumes (app data dir and the
    // document's folder aren't guaranteed to share one) - copy then remove
    // the original as a fallback "move".
    fs::copy(from, to).await?;
    fs::remove_file(from).await
}

/// Moves a first-saved draft's pasted images from the app's data dir into a
/// Typora-style `assets/` folder next to the now-real document, rewriting
/// each markdown `src` to the new relative path. Only touches paths that are
/// actually under the app data dir's `assets/` folder - anything else
/// (http(s), data:, or already-relative) is left alone, matching the
/// frontend's job of only offering draft-image candidates here.
#[tauri::command]
pub async fn migrate_draft_images(
    app: tauri::AppHandle,
    doc_path: String,
    srcs: Vec<String>,
) -> Result<Vec<ImageMigration>, String> {
    use tauri::Manager;

    require_non_empty(&doc_path)?;
    let Some(doc_dir) = Path::new(&doc_path).parent() else {
        return Err("document path has no parent directory".to_string());
    };
    let draft_assets_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("assets");
    let dest_dir = doc_dir.join("assets");

    let mut results = Vec::with_capacity(srcs.len());
    for old in srcs {
        let path = Path::new(&old);
        // Not a draft-origin image (e.g. some other absolute path the user
        // inserted directly) - silently skipped, not a migration failure:
        // `new: None` below is reserved for a draft image that WAS found
        // here but failed to move, which is the only case worth a toast.
        if path.parent() != Some(draft_assets_dir.as_path()) {
            continue;
        }
        let Some(name) = path.file_name() else {
            results.push(ImageMigration { old, new: None });
            continue;
        };

        let new = async {
            fs::create_dir_all(&dest_dir).await.ok()?;
            let mut dest_name = name.to_string_lossy().to_string();
            let mut n = 1;
            while dest_dir.join(&dest_name).exists() {
                let stem = Path::new(name).file_stem()?.to_string_lossy();
                let ext = Path::new(name)
                    .extension()
                    .map(|e| e.to_string_lossy().to_string());
                dest_name = match &ext {
                    Some(ext) => format!("{stem}-{n}.{ext}"),
                    None => format!("{stem}-{n}"),
                };
                n += 1;
            }
            move_file(path, &dest_dir.join(&dest_name)).await.ok()?;
            Some(format!("assets/{dest_name}"))
        }
        .await;

        results.push(ImageMigration { old, new });
    }
    Ok(results)
}

#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    require_non_empty(&path)?;
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    crate::atomic::write(Path::new(&path), contents)
        .await
        .map_err(|e| e.to_string())
}
