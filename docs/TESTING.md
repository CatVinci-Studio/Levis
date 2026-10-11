# Testing map

Five suites, from cheapest to most expensive:

```sh
npm run check                          # typecheck, lint, vitest, prettier, README structure
cd src-tauri && cargo test --workspace # app crate + aicompat
npm run test:visual                    # Playwright: the UI in Chromium
scripts/smoke-linux.sh --build         # the built Linux app and its .deb
npm run screenshots:readme             # regenerate the README screenshots
cd src-tauri && cargo test --lib live_eval -- --ignored --nocapture --test-threads=1
                                       # real Anthropic API (costs cents)
```

The first two run in CI, as do the Playwright flows with
`--ignore-snapshots` (screenshot baselines depend on the fonts of the machine
that took them). The rest need a display, a desktop session or an API key,
and are run by hand before a release. The visual suite needs Chromium once:
`npx playwright install chromium`.

## What is covered, by kind

The suites divide by _what kind of mistake they catch_, which is more useful
than dividing by file. Counts are left out on purpose - they go stale; run
the suite to see them.

### 1. Text and position algebra (vitest)

The group most worth having: this is where a bug is silent and destroys the
user's document.

| Area                    | Catches                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ai/doc-markdown`       | Markdown-space matching (exact, then typography-normalized), anchor disambiguation, inline vs block insertion, caret context. |
| `ai/chat/sentence-diff` | Splitting a proposal into per-sentence changes, and rebuilding the text from the subset the user ticked.                      |
| `ai/chat/line-diff`     | The diff shown on a proposal card.                                                                                            |
| `ai/pending-edit-focus` | Review order and where focus lands after accept/reject.                                                                       |
| `ai/text-locate`        | Locating plain text inside a block for the strike range.                                                                      |
| `ai/chat/user-message`  | The `<selected-text>`/`<attached-file>` wire format, round-tripped through the writer.                                        |
| `ai/ghost-text-plugin`  | Completion echo stripping, word-by-word accept, candidate splitting.                                                          |

### 2. Wire formats and provider dialects (`aicompat`)

Every one of these fails as an opaque HTTP 400 if it regresses, so they are
pinned rather than trusted.

- Turn-list → request body for three dialects (Responses API, Anthropic
  Messages, chat-completions), including tool-call grouping, image parts,
  prompt caching, empty assistant turns and the thinking setting per model.
- SSE stream accumulation: text deltas, indexed tool-call fragments,
  mid-stream errors.
- The agent loop: tool dispatch, step limit (ends on a synthetic assistant
  turn rather than a dangling tool result).
- Model-list tidying: what counts as a chat model, ordering by release.

### 3. Backend rules (app crate)

| Module                  | Catches                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai::agent`             | The scripted agent loop end to end, history compaction, where the document rides (current turn only), focus-section selection on long docs. |
| `ai::tools`             | `propose_edit`/`add_comment` anchor validation, including near-miss matching.                                                               |
| `ai::project`           | Project folder access: containment, hidden files, size caps, search, `.levis/style.md` and `.levis/library/` parsing and relevance.         |
| `ai::workspace`         | Skill parsing, root resolution and the too-broad-folder guard.                                                                              |
| `ai::client`            | Completion prompt assembly, candidate splitting, grammar-issue relocation (CJK offsets).                                                    |
| `ai::catalog`           | Every pinned default model exists in the models.dev snapshot.                                                                               |
| `commands::chat_window` | Which chat serves which editor, what a closed window frees.                                                                                 |
| `commands::attachment`  | OOXML text extraction and truncation marking.                                                                                               |
| `atomic`, `session`     | Secret files written 0600 and atomically, what a closing window leaves in the session.                                                      |

### 4. Frontend state and rendering (vitest)

Settings migration (a rejected value must not discard the rest), the
composer, streaming tool arguments, the proposal state machine
(docs/AI-PROPOSALS.md), cancelled turns, AI error classification, the chat
history grouping, the tutorial, the Windows-only window frame, menus and
shortcuts, export pagination, themes.

### 5. Visual (Playwright, `e2e/`)

The real frontend in Chromium against the Vite dev server, with the dev
Tauri shim (`src/dev-tauri-shim.ts`) standing in for the backend. Each test
drives a flow and compares a screenshot: first run, the sidebar lesson, a
document in light and dark (including the table-header regression, #15),
split view, zen mode, the AI panel, an agent reply with a reasoned edit, the
sentence picker and a comment (accepting only some sentences is checked in
the document), Quick Ask, settings.

Baselines are per platform. After an intended UI change:
`npm run test:visual -- --update-snapshots`, then look at every changed
image before keeping it - a baseline happily records a bug.

### 6. Built app (`scripts/smoke-linux.sh`)

The release binary and `.deb`: the package's binary, icons and `.desktop`
entry (takes files, claims Markdown); the app starting on a file; a second
launch handing its file to the running instance and exiting. Runs with
throwaway config/data directories. Window checks need niri; `--screenshot`
also needs the screen unlocked.

### 7. Live (`ai::live_eval`, ignored by default)

Writing tasks through the app's own prompts against the real API, with
automatic checks: completions (length, no echo, candidates), and agent tasks
(shorten, insert inline and at the cursor, answer without editing, a section
of a long document, review via comments, a library fact). The key comes from
`$LEVIS_ANTHROPIC_KEY_FILE` or `.anthropic-api-key.local` (git-ignored);
without one every test passes vacuously.

## What is deliberately not covered

- **WebKitGTK and WebView2 rendering.** The visual suite runs Chromium; the
  shipped app does not. The smoke test proves the Linux build starts, not
  that it looks the same.
- **macOS and Windows native behaviour**: drag-to-merge, the file dialogs,
  the updater, PDF export, notarized bundles. CI proves they compile.
- **Attachment extraction of real files.** The OOXML parser is tested on
  hand-written XML; `pdf-extract` and `calamine` are trusted.

Changes to window management, drafts, or anything that can lose unsaved
work must still be exercised by hand, and the PR should say what was.
