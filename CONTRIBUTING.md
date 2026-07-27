# Contributing to Levis

Thanks for taking the time. This is a Tauri app: a React + TypeScript
frontend in `src/`, a Rust backend in `src-tauri/`, and a provider-agnostic
AI client crate in `src-tauri/crates/aicompat/`.

## Getting set up

```sh
npm install
npm run tauri dev
```

You need a stable Rust toolchain and Node 20+. Linux also needs
`libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`.

`npm run dev` alone serves the frontend at <http://localhost:1420> in a plain
browser. A dev-only shim (`src/dev-tauri-shim.ts`) stubs the Tauri IPC so the
editor still mounts, which makes UI work fast to iterate on - but anything
touching the backend (attachments, windows, AI requests) needs the real app.

## Before you push

Run exactly what CI runs. There are two halves, and it is easy to run one and
forget the other:

```sh
npm run check                                          # tsc + eslint + vitest + prettier
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

175 tests: 104 frontend (vitest), 43 in the app crate, 28 in `aicompat`. They
cluster into four kinds - see `docs/TESTING.md` for the full map and for what
is deliberately _not_ covered.

New tests belong next to the code (`foo.ts` → `foo.test.ts`, `#[cfg(test)]
mod tests` in Rust). Name them as the claim they make, not as the function
they call:

```
a_model_this_login_cannot_use_falls_back_to_the_default
brings the chip back for a NEW selection after one was dismissed
```

A test whose name is `test_parse` tells a future reader nothing about what
broke when it fails.

There is no automated UI or end-to-end coverage - CSS, window management, and
anything native is verified by running the app. If your change touches those,
say in the PR what you exercised by hand.

## Pull requests

Target `main`. CI must pass. Keep the PR description focused on _why_; the
commit bodies carry the detail.

If a change is visible, include a before/after screenshot. If it touches
window behaviour, drafts, or anything that can lose the user's work, say
explicitly what you tested by hand.

## Releases

Maintainers only.

1. Bump the version in **three** files - `package.json`,
   `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` - and let
   `Cargo.lock` update.
2. Commit as `chore: bump version to X.Y.Z`.
3. Tag `vX.Y.Z` and push the tag. `.github/workflows/release.yml` builds,
   signs and notarizes for macOS/Windows/Linux, publishes the GitHub release,
   and points the Homebrew cask at it.

**Pre-releases**: a tag carrying a semver pre-release suffix (`v0.9.0-rc.1`)
is published as a GitHub pre-release and skips the Homebrew cask, so it
reaches nobody who did not go looking for it - the in-app updater reads
`releases/latest`, which excludes pre-releases.

One constraint the bundler imposes: the Windows MSI target requires a
pre-release identifier to be **numeric only**, so `0.9.0-rc.1` fails to bundle
while `0.9.0-1` succeeds. macOS and Linux accept either.
