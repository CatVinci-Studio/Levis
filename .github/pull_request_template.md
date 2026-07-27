<!--
Keep this focused on WHY. The commit bodies carry the detail; CI carries the
proof that it builds.
-->

## What and why

<!-- The problem this solves. If it fixes a bug, what the failure looked like
     from the user's side. -->

## Checked

<!-- Both halves - it is easy to run one and forget the other. -->

- [ ] `npm run check`
- [ ] `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace` (in `src-tauri/`)

## Exercised by hand

<!-- There is no UI or end-to-end coverage (see docs/TESTING.md), so say what
     you actually ran. REQUIRED if this touches window management, drafts,
     the updater, or anything else that can lose the user's work. Screenshots
     for anything visible. -->
