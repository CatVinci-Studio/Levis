<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Levis" width="120" height="120" />
</p>

<h1 align="center">Levis</h1>

<p align="center">
  <strong>一款所见即所得的 Markdown 编辑器 —— AI Agent 会悄悄参与其中。</strong><br>
  所见即所得；Agent 只在该出现的时候才出现，不会碍事。
</p>

<p align="center">
  <a href="https://github.com/CatVinci-Studio/Levis/releases/latest"><strong>下载</strong></a> ·
  <a href="./README.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/CatVinci-Studio/Levis/releases/latest"><img alt="version" src="https://img.shields.io/github/v/release/CatVinci-Studio/Levis"></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey">
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-yellow"></a>
</p>

---

> [!IMPORTANT]
> 由于还在攒钱买 Apple 开发者账户，目前可能提示**「Levis 已损坏，无法打开」**。应用本身安全开源，在终端执行一次以下命令即可正常打开：
>
> ```sh
> xattr -cr /Applications/Levis.app
> ```

## 这是什么

Levis 是一款所见即所得的 Markdown 编辑器，同时集成了现代化的 AI 功能，可以进行内容续写、语法检查，以及针对文档内容的提问。

## 为什么做这个

1. Typora 等编辑器，内存占用较大、速度较慢，并且不开源
2. 直接用 VS Code 或 Neovim 写 Markdown，往往需要分屏才能预览，无法真正做到所见即所得，这会带来额外的写作负担，让人无法完全专注。

而 Levis，就是一款以插件形式提供 AI 辅助的所见即所得 Markdown 编辑器。

## 安装

| 平台                   | 安装包                                                                   |
| ---------------------- | ------------------------------------------------------------------------ |
| macOS（Apple Silicon） | `Levis_X.Y.Z_aarch64.dmg`                                                |
| Windows                | `Levis_X.Y.Z_x64-setup.exe`（NSIS）· `_x64_en-US.msi`（WiX）             |
| Linux                  | `Levis_X.Y.Z_amd64.AppImage` · `_amd64.deb` · `Levis-X.Y.Z-1.x86_64.rpm` |

## 快速上手

1. 启动 Levis —— 会直接进入一个可编辑的空白草稿，无需先打开文件。
2. 打开 **设置 → AI**，选择一个提供方（ChatGPT、Claude、API Key 或自定义接口），登录或粘贴密钥。
3. 在同一面板中开启 **AI 续写** 和 **语法检查**，或者直接开始打字 —— 建议会以幽灵文字的形式出现，按 Tab 采纳。

## 从源码构建

```bash
git clone https://github.com/CatVinci-Studio/Levis.git
cd Levis
npm install

npm run tauri dev     # 完整 Tauri 应用（Rust 后端 + Vite 前端）
npm run tauri build   # 打包 .dmg / .msi / .AppImage / .deb / .rpm
npm run build          # tsc --noEmit + vite build
```

需要 [Node.js](https://nodejs.org) 20+、[Rust](https://rustup.rs)（stable），以及各平台的构建工具（macOS 上是 Xcode 命令行工具；Linux 上是 `libwebkit2gtk-4.1-dev`/`libappindicator3-dev`/`librsvg2-dev`/`patchelf`；Windows 上是 MSVC Build Tools）。

## License

[MIT](./LICENSE) © CatVinci Studio
