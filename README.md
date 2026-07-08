<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Levis" width="120" height="120" />
</p>

<h1 align="center">Levis</h1>

<p align="center">
  <strong>A Typora-style WYSIWYG Markdown editor with a built-in AI writing assistant.</strong><br>
  Write in a clean, distraction-free canvas — the raw syntax only shows up when your cursor is on it.
</p>

<p align="center">
  <a href="https://github.com/CatVinci-Studio/Levis/releases/latest"><strong>Download</strong></a> ·
  <a href="./README.zh.md">中文</a>
</p>

<p align="center">
  <a href="https://github.com/CatVinci-Studio/Levis/releases/latest"><img alt="version" src="https://img.shields.io/github/v/release/CatVinci-Studio/Levis"></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey">
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-yellow"></a>
</p>

---

## What it is

A cross-platform desktop Markdown editor built with [Milkdown](https://milkdown.dev/) (a ProseMirror-based editor framework), React, and [Tauri 2](https://tauri.app/). Headings, bold/italic, math, and other syntax render live instead of showing raw symbols — the markup only reappears when you click into it, Typora-style. An optional AI assistant can complete sentences as you type, flag grammar issues, and answer questions about the document you have open.

## Why

- **Distraction-free by default.** No raw `**`/`#`/`$...$` clutter — see it rendered, edit it in place.
- **Bring your own model.** Sign in with ChatGPT (Codex) or Claude, paste a plain OpenAI API key, or point it at any OpenAI-compatible endpoint (local models included) — pick per-provider model, test the connection, done.
- **An agent that reads your document.** Ask questions about what you're writing; on the Codex provider it can search the document via real tool calls instead of guessing.
- **Rich content that just works.** Tables, task lists, fenced code with a language picker and syntax highlighting, inline/block KaTeX math with a live preview while typing, and Mermaid diagrams rendered in place.
- **Typewriter mode.** Keeps your current line pinned near the center of the screen instead of drifting to the bottom.
- **Local-only credentials.** OAuth tokens and API keys are written to the OS app-config directory, never bundled or synced anywhere.

## Install

| Platform | Installer |
|---|---|
| macOS (Apple Silicon) | `Levis_X.Y.Z_aarch64.dmg` |
| Windows | `Levis_X.Y.Z_x64-setup.exe` (NSIS) · `_x64_en-US.msi` (WiX) |
| Linux | `Levis_X.Y.Z_amd64.AppImage` · `_amd64.deb` · `Levis-X.Y.Z-1.x86_64.rpm` |

→ Get the latest at [Releases](https://github.com/CatVinci-Studio/Levis/releases/latest). Builds are unsigned for now — first launch may need a right-click → Open on macOS, or "More info → Run anyway" on Windows SmartScreen.

## Quick start

1. Launch Levis — it opens straight into an editable blank draft, no file required until you save.
2. Open a folder (or save the draft into one) to get the file tree and outline sidebar.
3. Open **Settings → AI**, pick a provider (ChatGPT, Claude, API key, or custom endpoint), and sign in / paste a key.
4. Toggle **AI completion** and **grammar check** in the same panel, or just start typing — suggestions show up as ghost text; press Tab to accept.

## Editing features

- **Cursor-reveal syntax** — headings, bold/italic, and math show their raw markup only while the cursor is inside them.
- **Tables** — insert and edit via right-click: alignment, add/remove row or column, delete table.
- **Code blocks** — language picker in the header, syntax highlighting, Tab-to-indent, and safe escaping (Enter/Down) even when the block is the last thing in the document.
- **Math** — `$inline$` and `$$block$$` KaTeX rendering with a floating live preview while typing.
- **Mermaid diagrams** — fenced ` ```mermaid ` blocks render as diagrams in place.
- **Source mode** — drop into raw Markdown text at any time from the View menu.
- **Agent panel** — a chat tab in the sidebar for asking questions about the current document.

## Build from source

```bash
git clone https://github.com/CatVinci-Studio/Levis.git
cd Levis
npm install

npm run tauri dev     # full Tauri app (Rust shell + Vite renderer)
npm run tauri build   # bundle .dmg / .msi / .AppImage / .deb / .rpm
npm run build          # tsc --noEmit + vite build
```

Requires [Node.js](https://nodejs.org) 20+, [Rust](https://rustup.rs) (stable), and platform build tools (Xcode CLT on macOS; `libwebkit2gtk-4.1-dev`/`libappindicator3-dev`/`librsvg2-dev`/`patchelf` on Linux; MSVC Build Tools on Windows).

### Project layout

- `src/` — React + Milkdown frontend. `src/editor/` holds the ProseMirror plugins (one file per feature: ghost-text, grammar check, math, mermaid, cursor-reveal, etc.), `src/settings/` the settings panel and persisted-settings context, `src/agent/` the AI chat panel.
- `src-tauri/src/` — Tauri commands: file I/O, auth (`auth/`), and AI dispatch (`ai/`).
- `src-tauri/crates/aicompat/` — a standalone, app-agnostic Rust crate with the OAuth/API client logic for each AI provider (OpenAI Codex, Anthropic Claude, plain API key, custom OpenAI-compatible endpoints) plus a small tool-calling agent loop, kept separate from the main crate so it can be reused in other apps.

## License

[MIT](./LICENSE) © CatVinci Studio
