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

/// For credentials and API keys: the same write-then-rename, with the temp
/// file created owner-only (0600) on Unix from the start. Writing first and
/// tightening permissions after left a window where the secret sat in a
/// world-readable file, and a crash in between left it that way.
pub fn write_secret_sync(target: &Path, contents: impl AsRef<[u8]>) -> std::io::Result<()> {
    use std::io::Write;
    let tmp = tmp_path(target);
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp)?;
        file.write_all(contents.as_ref())?;
        file.sync_all()?;
        std::fs::rename(&tmp, target)
    })();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn secrets_are_owner_only_and_replace_atomically() {
        use std::os::unix::fs::PermissionsExt;
        let path = std::env::temp_dir().join(format!("levis-secret-{}.json", std::process::id()));
        write_secret_sync(&path, "one").unwrap();
        write_secret_sync(&path, "two").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "two");
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = std::fs::remove_file(&path);
    }
}
