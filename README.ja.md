<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Levis" width="120" height="120" />
</p>

<h1 align="center">Levis</h1>

<p align="center">
  <strong>WYSIWYGなMarkdownエディタ —— AI Agentがそっと寄り添います。</strong><br>
  見たままが結果になる。Agentは必要なときだけ手を貸し、邪魔はしません。
</p>

<p align="center">
  <a href="https://github.com/CatVinci-Studio/Levis/releases/latest"><strong>ダウンロード</strong></a> ·
  <a href="./README.md">English</a> ·
  <a href="./README.zh.md">中文</a>
</p>

<p align="center">
  <a href="https://github.com/CatVinci-Studio/Levis/releases/latest"><img alt="version" src="https://img.shields.io/github/v/release/CatVinci-Studio/Levis"></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey">
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-yellow"></a>
</p>

---

## これは何か

Levisは、文の続き書き、文法チェック、開いている文書についての質問応答など、現代的なAI機能を内蔵したWYSIWYGなMarkdownエディタです。

## なぜ作ったか

1. Typoraのようなエディタはメモリを多く消費し、動作が重く、オープンソースでもありません。
2. VS CodeやNeovimで直接Markdownを書く場合、通常は真のWYSIWYGではなくプレビューを分割表示する形になり、余計な手間がかかって集中しづらくなります。

Levisは、AIによる支援をプラグインとして提供するWYSIWYGなMarkdownエディタです —— 役立つときだけそこにあり、それ以外では姿を消します。

## インストール

macOS（Apple Silicon）は[Homebrew](https://brew.sh)から:

```sh
brew install --cask catvinci-studio/tap/levis
```

または[Releases](https://github.com/CatVinci-Studio/Levis/releases/latest)からインストーラーを取得:

| プラットフォーム | インストーラー |
|---|---|
| macOS (Apple Silicon) | `Levis_X.Y.Z_aarch64.dmg` |
| Windows | `Levis_X.Y.Z_x64-setup.exe`（NSIS）· `_x64_en-US.msi`（WiX） |
| Linux | `Levis_X.Y.Z_amd64.AppImage` · `_amd64.deb` · `Levis-X.Y.Z-1.x86_64.rpm` |

## クイックスタート

1. Levisを起動する —— ファイルを開かなくても、そのまま編集可能な空の草稿から始まります。
2. **設定 → AI** を開き、プロバイダー(ChatGPT、Claude、APIキー、またはカスタムエンドポイント)を選んでサインインするかキーを貼り付けます。
3. 同じパネルで **AI補完** と **文法チェック** を有効にするか、そのまま入力を始めてください —— 候補がゴーストテキストとして表示され、Tabキーで確定します。

## ソースからビルド

```bash
git clone https://github.com/CatVinci-Studio/Levis.git
cd Levis
npm install

npm run tauri dev     # 完全なTauriアプリ（Rustシェル + Vite レンダラー）
npm run tauri build   # .dmg / .msi / .AppImage / .deb / .rpm をビルド
npm run build          # tsc --noEmit + vite build
```

[Node.js](https://nodejs.org) 20+、[Rust](https://rustup.rs)（stable）、および各プラットフォームのビルドツール(macOSはXcode CLT、Linuxは`libwebkit2gtk-4.1-dev`/`libappindicator3-dev`/`librsvg2-dev`/`patchelf`、WindowsはMSVC Build Tools)が必要です。

## License

[MIT](./LICENSE) © CatVinci Studio
