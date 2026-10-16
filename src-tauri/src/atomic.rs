//! Write-then-rename helpers so a crash or power loss mid-write can't leave
//! a half-written file where a config/session/document used to be. The temp
//! file lives next to its target (same directory, same filesystem) so the
//! final rename is atomic rather than a cross-volume copy.
//!
//! A rename alone isn't enough: the filesystem may commit the rename before
//! the data, so after a power loss the target names an empty or truncated
//! file. Each writer therefore syncs the temp file before the rename, and
//! on Unix the directory after it, so the new name itself is on disk.

use std::io::Write;
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

/// Makes a completed rename in `target`'s directory durable. Best effort:
/// some filesystems (network mounts, a few FUSE ones) refuse to fsync a
/// directory, and by then the data itself is already safely written.
fn sync_parent_dir(target: &Path) {
    #[cfg(unix)]
    if let Some(dir) = target.parent() {
        let dir = if dir.as_os_str().is_empty() {
            Path::new(".")
        } else {
            dir
        };
        if let Ok(handle) = std::fs::File::open(dir) {
            let _ = handle.sync_all();
        }
    }
    // Windows has no directory handles to sync; NTFS journals the rename.
    #[cfg(not(unix))]
    let _ = target;
}

/// What replacing an existing file has to carry over: where it really is
/// (a symlink is written through, not replaced by a regular file) and its
/// permissions (the new file would otherwise get the default mode, and a
/// read-only file would quietly become writable). A read-only file is not
/// replaced at all: the user made it so, and the save says why it failed.
fn existing_target(target: &Path) -> std::io::Result<(PathBuf, Option<std::fs::Permissions>)> {
    let real = match std::fs::canonicalize(target) {
        Ok(real) => real,
        Err(_) => return Ok((target.to_path_buf(), None)),
    };
    let permissions = std::fs::metadata(&real)?.permissions();
    if permissions.readonly() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!("{} is read-only", real.display()),
        ));
    }
    Ok((real, Some(permissions)))
}

fn write_via_temp(target: &Path, contents: &[u8], secret: bool) -> std::io::Result<()> {
    // Secrets always get a fresh owner-only file; anything else keeps what
    // the file it replaces had.
    let (real, permissions) = if secret {
        (target.to_path_buf(), None)
    } else {
        existing_target(target)?
    };
    let target = real.as_path();
    let tmp = tmp_path(target);
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        if secret {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        #[cfg(not(unix))]
        let _ = secret;
        let mut file = options.open(&tmp)?;
        file.write_all(contents)?;
        if let Some(permissions) = permissions {
            file.set_permissions(permissions)?;
        }
        file.sync_all()?;
        drop(file);
        std::fs::rename(&tmp, target)
    })();
    match result {
        Ok(()) => {
            sync_parent_dir(target);
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// Sync version, for the handful of call sites that aren't already async.
pub fn write_sync(target: &Path, contents: impl AsRef<[u8]>) -> std::io::Result<()> {
    write_via_temp(target, contents.as_ref(), false)
}

/// For credentials and API keys: the same write-then-rename, with the temp
/// file created owner-only (0600) on Unix from the start. Writing first and
/// tightening permissions after left a window where the secret sat in a
/// world-readable file, and a crash in between left it that way.
pub fn write_secret_sync(target: &Path, contents: impl AsRef<[u8]>) -> std::io::Result<()> {
    write_via_temp(target, contents.as_ref(), true)
}

/// Async version: the same steps on the blocking pool, since fsync can
/// take a while (tens of milliseconds on macOS, where it flushes the
/// drive's cache) and mustn't stall the runtime's workers.
pub async fn write(target: &Path, contents: impl AsRef<[u8]>) -> std::io::Result<()> {
    let target = target.to_path_buf();
    let contents = contents.as_ref().to_vec();
    tokio::task::spawn_blocking(move || write_via_temp(&target, &contents, false))
        .await
        .map_err(std::io::Error::other)?
}

/// A scratch file in the system temp directory, removed again when this is
/// dropped - on every path out of the code holding it, early returns and
/// panics included.
///
/// On Linux the temp directory is a shared /tmp, so a fixed or guessable
/// name lets another local user plant a file or symlink there first and
/// have us write into it - and the CLI installer then copies that file
/// into /usr/local/bin as root. So the name carries a random part, the
/// file is created exclusively (never opening an existing file, nor
/// following a symlink), and on Unix only its owner can read or write it.
// Used by the desktop-only PDF export and CLI installer.
#[cfg_attr(mobile, allow(dead_code))]
pub struct TempFile {
    path: PathBuf,
}

#[cfg_attr(mobile, allow(dead_code))]
impl TempFile {
    /// Creates `<temp dir>/<prefix><random><suffix>` holding `contents`.
    pub fn create(prefix: &str, suffix: &str, contents: impl AsRef<[u8]>) -> std::io::Result<Self> {
        use std::hash::{BuildHasher, Hasher};
        let dir = std::env::temp_dir();
        let mut attempts = 0;
        loop {
            // RandomState is seeded from the OS's randomness: enough to make
            // the name unguessable without a dependency for it.
            let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
            hasher.write_u32(std::process::id());
            hasher.write_u32(COUNTER.fetch_add(1, Ordering::Relaxed));
            let path = dir.join(format!("{prefix}{:016x}{suffix}", hasher.finish()));

            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            match options.open(&path) {
                Ok(mut file) => {
                    // Owned from here, so a failed write still cleans up.
                    let temp = TempFile { path };
                    file.write_all(contents.as_ref())?;
                    return Ok(temp);
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && attempts < 16 => {
                    attempts += 1;
                }
                Err(e) => return Err(e),
            }
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temp_files_are_unique_private_and_removed_on_drop() {
        let a = TempFile::create("textus-test-", ".html", "<p>a</p>").unwrap();
        let b = TempFile::create("textus-test-", ".html", "<p>b</p>").unwrap();
        assert_ne!(a.path(), b.path());
        assert_eq!(std::fs::read_to_string(a.path()).unwrap(), "<p>a</p>");
        let name = a.path().file_name().unwrap().to_str().unwrap();
        assert!(name.starts_with("textus-test-") && name.ends_with(".html"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(a.path()).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        let path = a.path().to_path_buf();
        drop(a);
        assert!(!path.exists());
    }

    fn scratch_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("textus-atomic-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn leftovers(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect()
    }

    #[test]
    fn replaces_the_target_and_leaves_no_temp_file() {
        let dir = scratch_dir("sync");
        let path = dir.join("doc.md");
        write_sync(&path, "one").unwrap();
        write_sync(&path, "two").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "two");
        assert!(leftovers(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failed_write_cleans_up_its_temp_file() {
        let dir = scratch_dir("fail");
        // Renaming a file over a non-empty directory fails on every OS.
        let target = dir.join("taken");
        std::fs::create_dir_all(target.join("inside")).unwrap();
        assert!(write_sync(&target, "x").is_err());
        assert!(leftovers(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn the_async_writer_writes_too() {
        let dir = scratch_dir("async");
        let path = dir.join("draft.json");
        write(&path, b"{}").await.unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}");
        assert!(leftovers(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    // Unix only: modes and symlinks.
    #[cfg(unix)]
    #[test]
    fn a_replaced_file_keeps_its_mode_and_a_read_only_one_is_refused() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch_dir("mode");
        let shared = dir.join("shared.md");
        std::fs::write(&shared, "one").unwrap();
        std::fs::set_permissions(&shared, std::fs::Permissions::from_mode(0o664)).unwrap();
        write_sync(&shared, "two").unwrap();
        assert_eq!(std::fs::read_to_string(&shared).unwrap(), "two");
        let mode = std::fs::metadata(&shared).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o664, "the mode it had, not the default");

        let locked = dir.join("locked.md");
        std::fs::write(&locked, "keep").unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o444)).unwrap();
        let err = write_sync(&locked, "lost").unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::PermissionDenied);
        assert_eq!(std::fs::read_to_string(&locked).unwrap(), "keep");
        assert!(leftovers(&dir).is_empty());
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o644)).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_is_written_through_not_replaced() {
        let dir = scratch_dir("link");
        let real = dir.join("real.md");
        let link = dir.join("link.md");
        std::fs::write(&real, "one").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        write_sync(&link, "two").unwrap();
        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "two");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // Unix only: what it checks is the file mode, which Windows doesn't have.
    #[cfg(unix)]
    #[test]
    fn secrets_are_owner_only_and_replace_atomically() {
        use std::os::unix::fs::PermissionsExt;
        let path = std::env::temp_dir().join(format!("textus-secret-{}.json", std::process::id()));
        write_secret_sync(&path, "one").unwrap();
        write_secret_sync(&path, "two").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "two");
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = std::fs::remove_file(&path);
    }
}
