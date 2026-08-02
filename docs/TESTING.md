# Testing map

199 tests, in three suites. Run all of them with:

```sh
npm run check                                       # 128 frontend (vitest)
cd src-tauri && cargo test --workspace              # 43 app crate + 28 aicompat
```

## What is covered, by kind

The suites divide by _what kind of mistake they catch_, which is more useful
than dividing by file.

### 1. Text and position algebra — 45 tests

The largest group, and the one most worth having: this is where a bug is
silent and destroys the user's document.

| Area                    | Tests | Catches                                                                                                                        |
| ----------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ai/doc-markdown`       | 16    | Markdown-space matching, anchor disambiguation, edit composition. A wrong range applies an edit to the wrong text.             |
| `ai/chat/line-diff`     | 8     | The diff shown on a proposal card.                                                                                             |
| `ai/pending-edit-focus` | 8     | Review order and where focus lands after accept/reject.                                                                        |
| `ai/text-locate`        | 6     | Locating plain text inside a block for the strike range.                                                                       |
| `ai/chat/user-message`  | 7     | The `<selected-text>`/`<attached-file>` wire format, **round-tripped through the writer** - three places used to hand-roll it. |

### 2. Wire formats and provider dialects — 28 tests (`aicompat`)

Every one of these fails as an opaque HTTP 400 if it regresses, so they are
pinned rather than trusted.

- Turn-list → request body for three dialects (Responses API, Anthropic
  Messages, chat-completions), including how tool calls and results are
  grouped, which differs per provider.
- Image content parts per dialect, and that a text-only turn keeps its
  plain-string `content` (the shape that shipped before images existed).
- SSE stream accumulation: text deltas, indexed tool-call fragments,
  mid-stream errors.
- `openai_codex::usable_model` — a model saved under one auth method is a
  hard 400 under another.

### 3. Backend rules — 43 tests (app crate)

| Module                  | Tests | Catches                                                                                                                                                                            |
| ----------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commands::chat_window` | 11    | Window classification and the scope registry: which chat serves which editor, what a closed window frees. Every bug here was silent - a dropped tab, a menu command going nowhere. |
| `ai::workspace`         | 9     | Skill frontmatter parsing, comment stripping, and workspace-root resolution including the fall back when a chosen root is gone.                                                    |
| `commands::attachment`  | 8     | OOXML text extraction (namespace prefixes, breaks, tabs), truncation being marked rather than silent, and that the picker's format list matches what the extractor handles.        |
| `ai::client`            | 7     | Grammar-issue relocation, including CJK offset repair.                                                                                                                             |
| `ai::agent`             | 5     | Long-document truncation with char-boundary safety.                                                                                                                                |
| `ai::tools`             | 3     | `propose_edit` anchor validation.                                                                                                                                                  |

### 4. Frontend state and rendering — 83 tests

- `settings/SettingsContext` (9) — settings migration. Notably: a rejected
  value must not discard the rest of the blob.
- `ai/chat/ChatComposer` (8) — the selection chip re-arming for a new
  selection, attachment errors being shown rather than swallowed, vision
  gating.
- `ai/chat/partial-tool-args` (10) — parsing half-arrived streaming JSON.
- `ai/proposal-stream` (8) — the writing-phase state machine
  (docs/AI-PROPOSALS.md): when a streamed draft is placed, what a stop
  freezes, what a failure or invalid final arguments discard.
- `ai/proposal-status` (5) — proposal statuses annotated onto history at
  send time; unrelated tool results untouched, stored turns never mutated.
- `ai/cancelled-turns` (4) — what a stop keeps, and that an unanswered
  ToolCall gets a synthetic result before entering history.
- `onboarding/*` (18) — tutorial step progression and evaluation.
- `ui/WindowControls` (7) — the app-drawn window frame, which only exists on
  Windows and so is the half of the UI nobody developing on macOS ever sees:
  that it draws nothing at all where the OS still supplies a frame, that the
  app menu is labelled in the app's language rather than English, that items
  reach the backend by the id their native twin carries, and that the menu
  button closes a menu it opened.
- `ai/chat/useQuickAskReveal` (5), `editor/code-block-indent-plugin` (5),
  `utils/tauri-events` (2), `settings/sections/providers` (2).

## What is deliberately not covered

Worth knowing so nobody assumes a green suite means a working app.

- **No end-to-end or UI-automation tests.** Nothing drives the real Tauri
  app.
- **CSS is entirely unchecked.** Themes, the window bar, layout, dark mode -
  all verified by looking.
- **Native behaviour**: window creation, drag-to-merge, the file dialogs, the
  updater, PDF export, notarized bundles. Only CI's build step proves these
  compile; nothing proves they work.
- **Real provider requests.** Every AI test operates on request/response
  _shapes_. No test contacts a provider.
- **Attachment extraction of real files.** The OOXML parser is tested on
  hand-written XML; no fixture PDF, .docx or .xlsx is checked in, so
  `pdf-extract` and `calamine` are trusted as dependencies.

The practical consequence: **changes to window management, drafts, or
anything that can lose unsaved work must be exercised by hand**, and the PR
should say what was exercised.
