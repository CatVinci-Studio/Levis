//! Write-then-rename helpers so a crash or power loss mid-write can't leave
//! a half-written file where a config/session/document used to be. The temp
//! file lives next to its target (same directory, same filesystem) so the
//! final rename is atomic rather than a cross-volume copy.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

static COUNTER: AtomicU32 = AtomicU32::new(0);

fn tmp_path(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp_name = format!(".{name}.{stamp}-{seq}.tmp");
    target.with_file_name(tmp_name)
}

/// Sync version, for the handful of call sites that aren't already async.
pub fn write_sync(target: &Path, contents: impl AsRef<[u8]>) -> std::io::Result<()> {
    let tmp = tmp_path(target);
    let result = std::fs::write(&tmp, contents).and_then(|_| std::fs::rename(&tmp, target));
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

pub async fn write(target: &Path, contents: impl AsRef<[u8]>) -> std::io::Result<()> {
    let tmp = tmp_path(target);
    let result = match tokio::fs::write(&tmp, contents.as_ref()).await {
        Ok(()) => tokio::fs::rename(&tmp, target).await,
        Err(e) => Err(e),
    };
    if result.is_err() {
        let _ = tokio::fs::remove_file(&tmp).await;
    }
    result
}
