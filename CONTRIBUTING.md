# Contributing to Textus

Thanks for taking the time. This is a Tauri app: a React + TypeScript
frontend in `src/`, a Rust backend in `src-tauri/`, and a provider-agnostic
AI client crate in `src-tauri/crates/aicompat/`.

## Getting set up

```sh
npm install
npm run tauri dev
```

You need a stable Rust toolchain and Node 22+. Linux also needs
`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`.

`npm run dev` alone serves the frontend at <http://localhost:1420> in a plain
browser. A dev-only shim (`src/dev-tauri-shim.ts`) stubs the Tauri IPC so the
editor still mounts, which makes UI work fast to iterate on - but anything
touching the backend (attachments, windows, AI requests) needs the real app.

## Before you push

Run exactly what CI runs. There are two halves, and it is easy to run one and
forget the other:

```sh
npm run check                                          # tsc + eslint + vitest + prettier + README structure
npm run build                                          # tsc + vite build
cd src-tauri
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings   # --workspace: aicompat too
cargo test --workspace
```

`npm run format` and `cargo fmt --all` fix the formatting halves in place.

Note the two flags that catch things a plain invocation misses: `npm run
check` includes `prettier --check` (a bare `tsc && eslint && vitest` does
not), and `--workspace` includes the `aicompat` crate (a bare `cargo clippy`
does not).

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), with an
optional scope naming the area (`chat`, `ai`, `ui`, `editor`, `settings`,
`drafts`, `ci`):

```
fix(drafts): stop a new window recovering documents that are still open
feat(chat): read PDF, Office and image attachments
refactor(ui): one icon set, no emoji
```

Prefixes in use: `feat`, `fix`, `refactor`, `perf`, `style`, `docs`, `test`,
`chore`, `ci`.

**Split by concern, not by file.** A branch that fixes three things should be
three commits. The subject says what changed; the body says **why it was
wrong**: the failure it prevents, not a restatement of the diff. Silent
failure modes are worth spelling out, because nobody will rediscover them
from the code:

> Draft recovery answers a LAUNCH-time question, but the drain is per-window,
> and a window can be created at any time. Once the app is up, every snapshot
> on disk belongs to a live dirty tab, so Cmd+T "recovered" a document that
> was still open and unsaved.

## Code style

Formatting is automated, so it is not worth discussing. What is worth
discussing:

**Comments explain why, not what.** The codebase leans on this heavily. A
comment earns its place by recording a constraint, a rejected alternative, or
a bug that a future edit would otherwise reintroduce. Match the density of the
file you are editing.

**Cross-language contracts point at each other.** Any shape that exists in
both Rust and TypeScript carries a comment on each side naming the other
(`ChatAttachment`, `AgentTurn`, `StreamEvent`, `ProviderCatalogEntry`, the
chat-window protocol). If you change one, the comment tells you what else to
change.

**Prefer deepening the mechanism over special-casing.** A new `if` in shared
code to serve one caller usually means the fix is at the wrong depth.

## Tests

Five suites, cheapest first - see `docs/TESTING.md` for the full map and for
what is deliberately _not_ covered:

```sh
npm run check                          # typecheck, lint, vitest, prettier, README structure
cd src-tauri && cargo test --workspace # app crate + aicompat
npm run test:visual                    # Playwright screenshots of the UI in Chromium
scripts/smoke-linux.sh --build         # the built Linux app and its .deb
cd src-tauri && cargo test --lib live_eval -- --ignored --nocapture --test-threads=1
                                       # real Anthropic API (costs cents)
```

The first two run in CI, and so do the Playwright flows without their
screenshot comparison. The rest need a display, a desktop session or an API
key, and are run by hand before a release.

The visual suite needs Chromium once: `npx playwright install chromium`. Its
screenshot baselines depend on the fonts of the machine that took them; on
another machine either run `npm run test:visual -- --ignore-snapshots` (the
flows and their assertions only) or take local baselines. After an intended
UI change, `npm run test:visual -- --update-snapshots` and look at every
changed image before keeping it.

New tests belong next to the code (`foo.ts` → `foo.test.ts`, `#[cfg(test)]
mod tests` in Rust). Name them as the claim they make, not as the function
they call:

```
a_model_this_login_cannot_use_falls_back_to_the_default
brings the chip back for a NEW selection after one was dismissed
```

A test whose name is `test_parse` tells a future reader nothing about what
broke when it fails.

The visual suite runs the frontend in Chromium against the dev Tauri shim, not
in WebKitGTK or WebView2, so native behaviour - window management, drag
between windows, file dialogs, the updater - is still verified by running the
app. If your change touches those, say in the PR what you exercised by hand.

## Pull requests

Target `main`. CI must pass. Keep the PR description focused on _why_; the
commit bodies carry the detail.

If a change is visible, include a before/after screenshot. If it touches
window behaviour, drafts, or anything that can lose the user's work, say
explicitly what you tested by hand.

## Releases

Maintainers only. The desktop release is below; the iOS app ships
separately, from an `ios-v*` tag through `.github/workflows/ios-release.yml`
to TestFlight - see `docs/ios/release.zh.md`. `docs/README.md` indexes the
rest of the documentation.

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json`, then run `npm install --package-lock-only`
   and `cargo check` (in `src-tauri/`) so `package-lock.json` (both of its
   version fields) and `Cargo.lock` follow. `node scripts/check-versions.mjs`
   (part of `npm run check`) fails until all five files agree.
2. Write the release notes in `docs/releases/X.Y.Z.md` - the release
   workflow refuses a stable tag without them.
3. Commit as `chore: bump version to X.Y.Z`.
4. Tag `vX.Y.Z` and push the tag. `.github/workflows/release.yml` checks
   that the tag matches the version in those files, then builds,
   signs and notarizes for macOS/Windows/Linux, publishes the GitHub release,
   points the Homebrew cask at it, and sends the tested `textus-bin` package
   to the `[catvinci]` pacman repository in `CatVinci-Studio/arch-repo` (see
   `packaging/arch/README.md`).

**Pre-releases**: a tag carrying a semver pre-release suffix (`v0.9.0-rc.1`)
is published as a GitHub pre-release. The version files carry the same
suffix (`0.9.0-rc.1`): the tag check compares the whole version, and
release notes are only required for stable tags. It skips the Homebrew
cask and the `[catvinci]` pacman repository, so it reaches nobody who did not
go looking for it - the in-app updater reads `releases/latest`, which
excludes pre-releases.

**Rebuilds**: running the Release workflow by hand on an existing tag
rebuilds and republishes that release. The Homebrew cask and the pacman
repository only move when the tag is the newest stable one, so rebuilding
an old tag never downgrades anyone.

Windows ships only the **NSIS** installer (`-setup.exe`), for stable and
pre-release tags alike - the target list lives in
`src-tauri/tauri.windows.conf.json`. MSI is not built: an MSI install and an
NSIS install don't recognise each other, which made upgrades ask to uninstall
first, and MSI cannot bundle a non-numeric pre-release such as `0.9.0-rc.1`
anyway.
