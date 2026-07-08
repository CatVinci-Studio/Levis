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

## 这是什么

Levis 首先是一款所见即所得的 Markdown 编辑器 —— 所见即所得，没有原始语法的干扰。

AI Agent 可以在你写作的同时悄悄参与 —— 续写一句话、指出一个语法问题、回答一个关于文档内容的问题 —— 但在真正有用之前，它不会打扰你。不强制登录，不会强行弹出聊天窗口，也不会在背后偷偷改你的文档。

## 为什么做这个

- **默认所见即所得。** 没有 `**`/`#`/`$...$` 这些原始符号的干扰 —— 所见即所得，就地编辑。
- **Agent 是参与者，不是主导者。** 续写和语法检查只是安静的建议，不是打断；只有你主动提问时，它才会就文档内容回答。
- **自带模型任你选。** 使用 ChatGPT (Codex) 或 Claude 登录，粘贴普通的 OpenAI API Key，或者指向任意兼容 OpenAI 接口的服务（包括本地模型）。
- **开箱即用的富内容。** 表格、任务列表、带语言选择和语法高亮的代码块、支持输入时实时预览的行内/块级 KaTeX 公式，以及就地渲染的 Mermaid 图表。
- **打字机模式。** 让当前行始终固定在屏幕中央附近，而不是不断往下掉。
- **凭证仅存本地。** OAuth token 和 API Key 只写入系统的应用配置目录，不会被打包或同步到任何地方。

## 安装

| 平台 | 安装包 |
|---|---|
| macOS（Apple Silicon） | `Levis_X.Y.Z_aarch64.dmg` |
| Windows | `Levis_X.Y.Z_x64-setup.exe`（NSIS）· `_x64_en-US.msi`（WiX） |
| Linux | `Levis_X.Y.Z_amd64.AppImage` · `_amd64.deb` · `Levis-X.Y.Z-1.x86_64.rpm` |

→ 前往 [Releases](https://github.com/CatVinci-Studio/Levis/releases/latest) 获取最新版本。目前构建产物未签名 —— macOS 上首次启动可能需要右键点击「打开」，Windows 上可能需要在 SmartScreen 提示里选择「更多信息 → 仍要运行」。

## 快速上手

1. 启动 Levis —— 会直接进入一个可编辑的空白草稿，无需先打开文件。
2. 打开一个文件夹（或把草稿保存进某个文件夹），即可看到文件树和大纲侧边栏。
3. 打开 **设置 → AI**，选择一个提供方（ChatGPT、Claude、API Key 或自定义接口），登录或粘贴密钥。
4. 在同一面板中开启 **AI 续写** 和 **语法检查**，或者直接开始打字 —— 建议会以幽灵文字的形式出现，按 Tab 采纳。

## 编辑功能

- **光标显现语法** —— 标题、粗体/斜体、公式只有在光标停留其中时才显示原始标记。
- **表格** —— 通过右键菜单插入和编辑：对齐方式、增删行列、删除表格。
- **代码块** —— 头部带语言选择器、语法高亮、Tab 缩进，即便代码块是文档最后一个元素，也能安全地用 Enter/下方向键跳出。
- **公式** —— `$行内$` 和 `$$块级$$` 的 KaTeX 渲染，输入时带浮动实时预览。
- **Mermaid 图表** —— ` ```mermaid ` 代码围栏会就地渲染成图表。
- **源码模式** —— 随时可从 View 菜单切换到原始 Markdown 文本。
- **Agent 面板** —— 侧边栏里的聊天标签，可以就当前文档内容提问。

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

### 项目结构

- `src/` —— React + Milkdown 前端。`src/editor/` 存放各个 ProseMirror 插件（每个功能一个文件：续写、语法检查、公式、Mermaid、光标显现语法等），`src/settings/` 是设置面板和持久化设置的 context，`src/agent/` 是 AI 聊天面板。
- `src-tauri/src/` —— Tauri 命令：文件读写、登录鉴权（`auth/`）、AI 调用分发（`ai/`）。
- `src-tauri/crates/aicompat/` —— 一个独立的、与具体项目无关的 Rust 库，包含各 AI 提供方（OpenAI Codex、Anthropic Claude、普通 API Key、自定义兼容 OpenAI 接口）的 OAuth/API 客户端逻辑，以及一个小型的工具调用 Agent 循环，与主程序分离以便在其他项目中复用。

## License

[MIT](./LICENSE) © CatVinci Studio
