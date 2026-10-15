<!-- The English README is the reference: every README.<lang>.md follows its
     structure section by section (scripts/check-readmes.mjs). -->

<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Textus" width="120" height="120" />
</p>

<h1 align="center">Textus</h1>

<p align="center">
  <strong>The next-generation Markdown editor.</strong><br>
  You hold the pen. AI keeps your ink flowing.
</p>

<p align="center">
  <a href="https://textus.catvinci.com"><strong>Website</strong></a> ·
  <a href="https://github.com/CatVinci-Studio/Textus/releases/latest"><strong>Download</strong></a>
</p>

<p align="center">
  English ·
  <a href="./README.zh.md">简体中文</a> ·
  <a href="./README.zh-Hant.md">繁體中文</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.ko.md">한국어</a> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.fr.md">Français</a> ·
  <a href="./README.de.md">Deutsch</a> ·
  <a href="./README.ru.md">Русский</a> ·
  <a href="./README.pt.md">Português</a>
</p>

<p align="center">
  <a href="https://github.com/CatVinci-Studio/Textus/releases/latest"><img alt="version" src="https://img.shields.io/github/v/release/CatVinci-Studio/Textus"></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey">
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-yellow"></a>
</p>

<p align="center">
  <img src="docs/images/readme/en/hero.png" alt="Textus with Hamlet open. Beside it, Textus AI proposes an edit with its reason, sentence by sentence, and pins a review comment to a line." width="860" />
</p>

## Writing

### What you see is what you get

Every Markdown mark, rendered as you write. Point at a line to see its Markdown.

### Formulas, tables, diagrams

Math renders as you type, tables line up, and a few lines of text draw a diagram.

### Your writing style? Your call

Four writing modes, any theme you like – Typora themes included.

- **Zen Mode**: everything but your words steps away.
- **Typewriter Mode**: the line you are writing stays at the same height.
- **Split View**: Markdown on one side, the finished page on the other.
- **Source Code Mode**: the whole document as plain Markdown.

<p align="center">
  <img src="docs/images/readme/en/split.png" alt="Split View" width="49%" />
  <img src="docs/images/readme/en/zen.png" alt="Zen Mode" width="49%" />
</p>

### Share it anywhere

Export to PDF, Word, HTML and more.

## Textus AI

**It suggests. You decide.** Textus AI helps at every step. Every word stays yours.

- **Continuation**: Pause, and the next words appear in grey. Tab takes them.
- **AI writing**: Edits arrive as proposals, each with a reason. Take one whole, or sentence by sentence.
- **Grammar check**: Typos and grammar are flagged as you write, along with your own conventions. Alt+Enter fixes them.
- **Review**: Comments pinned to the lines they mean. Notes, not rewrites.
- **Built-in skills**: Tighten, proofread, translate, change the tone and more, one slash away.
- **It knows you**: It learns your style, remembers your characters and places, and follows your instructions.

**Use the AI you prefer**: Sign in with ChatGPT or Claude, add an API key, or run a model on your own computer.

OpenAI · Anthropic · Google Gemini · DeepSeek · xAI · Mistral · Groq · OpenRouter · Kimi · GLM · Qwen · Ollama · Any OpenAI-compatible endpoint

## Privacy

Your writing stays yours. Textus is built so that it can, and its code is open so that anyone can check.

- **On your device**: Documents are plain Markdown files, kept wherever you choose.
- **Keys kept locally**: API keys and sign-ins are stored only on your computer.
- **Straight to your provider**: AI requests travel directly from your device to the provider you pick.
- **No account**: Download it and write. There is nothing to sign up for.
- **No tracking**: No analytics, no telemetry, no ads.
- **Open source**: MIT-licensed and public, line by line, so anyone can verify all of this.

With a local model through Ollama, your words never leave your computer.

## Install

macOS (Apple Silicon) via [Homebrew](https://brew.sh):

```sh
brew install --cask catvinci-studio/tap/textus
```

Arch Linux via the signed [`[catvinci]`](https://github.com/CatVinci-Studio/arch-repo) pacman repository (once; `sudo pacman -Syu` then keeps Textus up to date):

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/CatVinci-Studio/arch-repo/main/install.sh) textus-bin
```

Or download an installer from [Releases](https://github.com/CatVinci-Studio/Textus/releases/latest):

| Platform              | Installer                                                                  |
| --------------------- | -------------------------------------------------------------------------- |
| macOS (Apple Silicon) | `Textus_X.Y.Z_aarch64.dmg`                                                 |
| Windows               | `Textus_X.Y.Z_x64-setup.exe`                                               |
| Linux                 | `Textus_X.Y.Z_amd64.AppImage` · `_amd64.deb` · `Textus-X.Y.Z-1.x86_64.rpm` |

## Quick start

1. Launch Textus. It opens on a blank draft; you only need a file when you save.
2. Open **Settings → Textus AI**, choose a provider, and sign in or paste a key under **Login & credentials**.
3. Start typing. A continuation appears in grey when you pause; Tab accepts it.
4. Open the AI panel with the chat button in the window bar. **Help → AI Features Guide** covers the rest.

| Action                 | Shortcut                     |
| ---------------------- | ---------------------------- |
| AI panel               | Ctrl/⌘+Shift+L               |
| Quick Ask              | Ctrl/⌘+Shift+K               |
| Suggest completion now | Ctrl/⌘+Shift+Space           |
| Check grammar now      | Ctrl/⌘+Shift+G               |
| Accept a pending edit  | Ctrl/⌘+Enter                 |
| Split View             | Ctrl/⌘+Shift+E               |
| Zen Mode               | Ctrl/⌘+Shift+J (Esc to exit) |
| Source Code Mode       | Ctrl/⌘+/                     |

All of them can be changed in **Settings → Shortcuts**.

## Build from source

```bash
git clone https://github.com/CatVinci-Studio/Textus.git
cd Textus
npm install

npm run tauri dev     # full Tauri app (Rust shell + Vite renderer)
npm run tauri build   # bundle .dmg / -setup.exe (NSIS) / .AppImage / .deb / .rpm
npm run build         # frontend only: type-check (tsc) + vite build
```

Requires [Node.js](https://nodejs.org) 22+, [Rust](https://rustup.rs) (stable), and platform build tools (Xcode CLT on macOS; `libwebkit2gtk-4.1-dev`/`libappindicator3-dev`/`librsvg2-dev`/`patchelf` on Linux; MSVC Build Tools on Windows).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the checks CI runs, commit conventions and the release process. [docs/TESTING.md](docs/TESTING.md) maps what the test suites cover – and what they deliberately don't. Contributions are discussed in English or Chinese.

## License

[MIT](./LICENSE) © CatVinci Studio
