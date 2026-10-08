//! Which channel installed this build, fixed at compile time through the
//! LEVIS_DISTRIBUTION environment variable:
//!
//!   direct    (default) GitHub Release installers - the in-app updater owns
//!             upgrades
//!   homebrew  a Homebrew package
//!   aur       the levis-bin AUR package
//!
//! For every channel except `direct` a package manager owns the installed
//! files. If the app replaces them itself, the package manager's records
//! no longer match the disk, so the frontend only reports a new version
//! there and does not install it.

const DISTRIBUTION: &str = match option_env!("LEVIS_DISTRIBUTION") {
    Some(value) => value,
    None => "direct",
};

// A typo such as LEVIS_DISTRIBUTION=arch would otherwise ship a package
// build that still updates itself. Fail the build instead.
const _: () = {
    let ok = matches!(DISTRIBUTION.as_bytes(), b"direct" | b"homebrew" | b"aur");
    assert!(
        ok,
        "LEVIS_DISTRIBUTION must be one of: direct, homebrew, aur"
    );
};

#[tauri::command]
pub fn app_distribution() -> &'static str {
    DISTRIBUTION
}
