# What Levis stores, and where

Everything the app remembers between launches, so that it can be backed up,
inspected, and, at 1.0.0, imported by Textus (the app's new name, with a new
identifier) by copying files.

Up to 0.9.6 the settings and histories lived in the webview's localStorage.
That store belongs to the webview engine: it is keyed by app identifier and
kept in a different format on every platform (SQLite under WebKitGTK and
WKWebView, LevelDB under WebView2), so another app can't read it, and every
window wrote the whole settings object back on each change, so two windows
undid each other's changes. Since 0.9.7 they are plain JSON files owned by
Rust (`src-tauri/src/settings.rs`).

## Directories

The app identifier is `com.chengaoshen.levis`. Tauri's app directories:

| Platform | Config directory                                                          | Data directory                          |
| -------- | ------------------------------------------------------------------------- | --------------------------------------- |
| Linux    | `~/.config/com.chengaoshen.levis/`                                        | `~/.local/share/com.chengaoshen.levis/` |
| macOS    | `~/Library/Application Support/com.chengaoshen.levis/`                    | the same directory                      |
| Windows  | `%APPDATA%\com.chengaoshen.levis\`                                        | the same directory                      |
| iOS      | `Library/Application Support/com.chengaoshen.levis/` in the app container | the same directory                      |

(`$XDG_CONFIG_HOME` and `$XDG_DATA_HOME` move the Linux ones.)

## Files

Debug builds write `*.dev.json` instead of `*.json` for the four files
marked †, so a development build never rewrites an installed app's settings
(the two share an identifier, hence the directories).

### Config directory

| File                                                                                                | What                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `settings.json` †                                                                                   | Every setting in Settings, plus zoom and the onboarding flags: `{"schemaVersion": 1, "settings": {...}}`. Field names and meanings are the `Settings` interface in `src/settings/SettingsContext.tsx`. |
| `prefs.json`                                                                                        | `editor_window_size`, written by Rust when an editor window closes. Also still holds `new_document_mode` and `restore_session_on_startup` from 0.9.6, no longer read after the first launch of 0.9.7.  |
| `session.json`                                                                                      | The documents each window had open, for session restore (desktop).                                                                                                                                     |
| `recent_files.json`                                                                                 | File > Open Recent (desktop).                                                                                                                                                                          |
| `themes/<id>/light.css`, `dark.css`                                                                 | Imported themes. `settings.userThemes` lists them.                                                                                                                                                     |
| `agent/agent.md`, `agent/skills/`                                                                   | The global Agent instructions and skills.                                                                                                                                                              |
| `provider_keys.json`, `api_key.json`, `custom_endpoint.json`, `auth-codex.json`, `auth-claude.json` | AI credentials (owner-only on Unix).                                                                                                                                                                   |

### Data directory

| File                       | What                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ui-state.json` †          | Where the UI was left: `{"schemaVersion": 1, "state": {...}}` with the fields of `UiState` in `src/storage/ui-state.ts`. |
| `chat-history.json` †      | Saved Agent conversations, most recent first, at most 60: `{"schemaVersion": 1, "entries": [...]}`.                      |
| `clipboard-history.json` † | The clipboard panel, newest first, at most 30 entries of up to 50,000 characters.                                        |
| `drafts/`                  | Crash recovery for unsaved documents.                                                                                    |
| `assets/`                  | Images pasted into a document that has not been saved yet (referenced by absolute path until it is).                     |

The webview's own storage also lives here (`localstorage/`, `WebKitCache/`
and so on; `EBWebView\` under `%LOCALAPPDATA%` on Windows). Since 0.9.7 the
only key the app still uses there is `levis-fetched-models:<provider>`, a
cache of each provider's model list that is simply fetched again when
missing.

## How the files are written

- Rust holds each file in memory and is its only writer. Windows change
  settings and UI state one top-level field at a time (`settings_patch`,
  `ui_state_patch`), and the histories one entry at a time
  (`history_upsert`, `history_remove`, `history_clear`) - never by writing a
  whole object or list back, so two windows changing different things both
  land. Every settings and history change is broadcast to all windows.
- Writes are debounced by 250 ms and flushed when the app exits, through a
  write-then-rename, so a crash never leaves a half-written file. That
  debounce is the only one: windows send every change as it is made,
  keystrokes in Custom CSS included, so quitting right after typing loses
  nothing.
- A file that can't be parsed is renamed to `<name>.corrupt-<unix time>` and
  the app starts from defaults rather than refusing to start.
- `schemaVersion` changes only for a change an older reader would misread.
  Adding a field never needs it: readers fill in defaults for missing fields.
- Before a window loads, Rust injects the current settings and UI state as
  `window.__BOOT__` and applies the theme, so the first frame is already
  right (`src-tauri/src/boot.js`, `src/storage/boot.ts`). On macOS a
  window shows a background in the app's appearance until its page first
  paints, so Rust also sets the app's appearance from a pinned Light or
  Dark (`apply_app_theme` in `settings.rs`).

## The move out of localStorage (0.9.6 to 0.9.7)

On the first launch without `settings.json`, every window boots with
`legacyImport`. The first window to load reads its localStorage -
`catvinci-settings`, `levis-chat-history`, `levis-clipboard-history`,
`levis-tutorial-progress`, `levis-agent-panel-open`,
`levis-agent-panel-width`, and on iOS `levis-ios-recent-documents` and
`levis.documentListView` - and hands it to Rust
(`settings_import_legacy`), which keeps the first such offer only. Until it
arrives, `prefs.json`'s two old keys stand in for the settings Rust needs
at startup. The localStorage keys are left untouched, so a downgrade to
0.9.6 still finds everything as it was.

## Importing into Textus

Textus will have a new identifier, so its directories are new and empty. On
its first launch, if its own `settings.json` doesn't exist, it can import a
Levis installation by copying from the Levis directories above:

1. `settings.json`, `ui-state.json`, `chat-history.json`,
   `clipboard-history.json` - read with the same code, since the format is
   the same. A `schemaVersion` newer than Textus knows means a newer Levis
   wrote it; read it best-effort (unknown fields are kept) rather than
   discard it.
2. `themes/`, `agent/`, `recent_files.json`, `session.json`, `prefs.json`
   as they are.
3. Credentials only with the user's consent, keeping them owner-only.
4. Not `drafts/` and `assets/` by default: drafts are crash leftovers, and
   documents refer to `assets/` by absolute path into the Levis directory,
   which stays where it is.

The Levis directories are left in place, so Levis keeps working alongside.
A Levis older than 0.9.7 has no files to copy; Textus doesn't read another
app's webview storage, so such a user updates Levis once first.
