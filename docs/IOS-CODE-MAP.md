# iOS 代码地图（Phase 0）

同一份代码同时构建桌面版（macOS / Windows / Linux）和 iOS 版。本文说明哪些代码共享、哪些仅限桌面，以及两边是如何隔开的。原则：**桌面行为保持不变**；iOS 上桌面专属的东西既不编译，也不被调用。

## Rust（`src-tauri/`）

### 怎么隔开

- `tauri-build` 会按目标平台自动设置 `cfg(desktop)` 或 `cfg(mobile)`。桌面专属代码统一用 `#[cfg(desktop)]` 标注，iOS 专属代码用 `#[cfg(mobile)]`；没有标注的就是共享代码。
- **依赖**：`tauri-plugin-updater`、`tauri-plugin-process` 放在 `Cargo.toml` 的 `[target.'cfg(not(any(target_os = "ios", target_os = "android")))'.dependencies]` 下（这两个插件的元数据里，iOS 支持度是 none）。`tauri-plugin-single-instance` 本来就只在 Windows/Linux 上引入，macOS 的 PDF 依赖（objc2-\*）和 Windows/Linux 的 webview 依赖本来就按 OS 区分。`opener`、`dialog` 支持 iOS，保持共享。附件解析用的 `pdf-extract`、`calamine`、`zip`、`quick-xml` 都是纯 Rust 实现，同样共享。
- **命令注册**：`lib.rs` 里只有一个 `invoke_handler`。共享命令写在 `generate_handler!` 列表前半部分；桌面命令放在后半部分，每条前面加 `#[cfg(desktop)]`（tauri-macros 支持对单条命令加属性），所以 iOS 上这些命令根本不会注册。
- **Builder**：共享部分包括 opener、dialog 两个插件和 `PendingOpenPaths`，写在 `run()` 里。桌面部分写在 `desktop_builder()`，包括 updater/process 插件、窗口/拖拽/会话/聊天窗口的状态、`on_window_event`，以及 `setup`（argv、会话恢复、CLI、菜单栏、窗口尺寸）。
- **权限（capabilities）**：`capabilities/default.json` 是共享的，包含 core、opener、dialog、event。`capabilities/desktop.json` 用 `"platforms": ["linux","macOS","windows"]` 限定为桌面，放窗口 chrome、全屏、置顶、标题，以及 updater/process 相关的权限。不拆开的话，iOS 构建会因为找不到 `updater:default` 而失败。
- **配置**：`tauri.conf.json` 新增了 `bundle.iOS.minimumSystemVersion = "16.0"`。`tauri.ios.conf.json` 会合并进 iOS 配置，内容有两项：一是只保留一个没有桌面窗口选项的 main 窗口；二是 `createUpdaterArtifacts: false`。`macOSPrivateApi` 不要在 iOS 配置里关掉，否则 CLI 会改写 `Cargo.toml` 里 tauri 的 features。

### 模块归属

| 模块                                                                         | 归属         | 说明                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `menu.rs`                                                                    | 仅桌面       | 菜单栏，以及菜单相关命令 `trigger_menu_item`、`list_recent_files`                                                                                                                                                                                                                                                     |
| `tab_drag.rs`                                                                | 仅桌面       | 标签页在窗口之间拖拽                                                                                                                                                                                                                                                                                                  |
| `commands/chat_window.rs`                                                    | 仅桌面       | 弹出的独立聊天窗口                                                                                                                                                                                                                                                                                                    |
| `commands/session.rs`                                                        | 仅桌面       | 按窗口恢复会话、退出流程                                                                                                                                                                                                                                                                                              |
| `commands/prefs.rs`                                                          | 仅桌面       | 新文档开在窗口还是标签页、会话恢复开关、窗口尺寸                                                                                                                                                                                                                                                                      |
| `commands/cli.rs`                                                            | 仅桌面       | 安装 `levis` 终端命令                                                                                                                                                                                                                                                                                                 |
| `commands/export.rs`                                                         | 大部分仅桌面 | pandoc（需要外部进程）、PDF 原生导出、`reveal_in_dir` 仅桌面；`export_save_dialog` 共享                                                                                                                                                                                                                               |
| `ai/workspace.rs`                                                            | 大部分共享   | `pick_workspace_root`（iOS 没有文件夹选择器）和 `open_global_agent_dir`（在文件管理器里打开）仅桌面                                                                                                                                                                                                                   |
| `lib.rs`                                                                     | 混合         | 窗口创建与 chrome、`open_new_window`、`paths_from_argv`、Wayland 检测、`take_pending_show_help`、单实例都仅桌面；`take_pending_open_path(s)` 共享；`queue_paths_to_open` 桌面和 iOS 各有一份实现（iOS 版不开窗口：UI 未就绪时先排队，就绪后直接发 `open-paths-as-tabs`）；`RunEvent::Opened` 在 macOS 和 iOS 上都处理 |
| `commands/fs.rs`、`drafts.rs`、`themes.rs`、`image_host.rs`、`attachment.rs` | 共享         | `fs.rs` 里的 `set_parent` 只在桌面（非 macOS）使用                                                                                                                                                                                                                                                                    |
| `commands/recents.rs`                                                        | 共享         | 只记录列表；同步到 File > Open Recent 菜单的那一步仅桌面                                                                                                                                                                                                                                                              |
| `ai/*`、`auth/*`、`crates/aicompat`、`distribution.rs`、`atomic.rs`          | 共享         |                                                                                                                                                                                                                                                                                                                       |

## 前端（`src/`）

- `src/utils/platform.ts`：新增 `isIOSPlatform()` 和 `isDesktop()`。iPhone 的 `navigator.platform` 是 `iPhone`；iPad 默认使用桌面版 UA，会报 `MacIntel`，因此用 `navigator.maxTouchPoints > 1` 来区分 iPad 和真正的 Mac。
- `src/platform/capabilities.ts`：**集中定义平台策略的唯一位置**。调用方只读这里的标志，不自己判断操作系统。标志包括 `isDesktopApp`、`canUseWindows`（多窗口、窗口标题、关闭/销毁窗口、会话恢复）、`hasAppMenu`、`canDragTabsBetweenWindows`（桌面且为 macOS）、`canDetachChat`、`canToggleFullscreen`、`canAutoUpdate`、`canExportPdf`、`canExportWithPandoc`、`canRevealInFileManager`、`canPickFolder`、`canInstallCliCommand`。
- 使用这些标志的地方：
  - App：设置窗口标题、上报会话路径、关闭最后一个标签时销毁窗口、禅模式全屏、标签页拖出
  - 其他：`useTabDragMerge`（拖动整个窗口合并）、`startup-restore`、`useAppUpdate`、`useDetachedChat`、MilkdownEditor 和 AgentPanelView 的弹出按钮、设置面板（新文档模式、会话恢复、CLI、更新按钮、工作区文件夹、在文件管理器中打开、展开为窗口）、ProjectBar、`export-doc`、`app-menu-actions` 的全屏、`window-chrome`（iOS 上 `data-window-chrome="mobile"`）
- `src/ipc.ts`：桌面命令一律通过 `desktopQuery`（iOS 上直接返回空值）或 `desktopAction`（iOS 上直接 reject）调用，作为最后一道防线，防止漏网的调用点打到 Rust。
- 桌面上的行为没有任何变化：所有标志在桌面上都和原来的判断等价，`canDragTabsBetweenWindows` 就是原来的 `isMacPlatform()`。

## 文件访问（iOS）

方案见 `docs/IOS-PLAN.zh.md` 的"文件访问方案"一节。代码分三处：

- **原生插件 `src-tauri/plugins/levis-files`：** Swift 实现在 `ios/Sources/LevisFilesPlugin.swift`，Rust 部分只做转发，并且只在 iOS 上编译（工作区成员，桌面上是一个空 crate）。提供的方法：
  - 选择文件、选择文件夹；
  - 在授权范围内读写、列目录，读写经过 NSFileCoordinator；
  - 把授权存成 bookmark（`remembered` / `forget`）；
  - `begin_access`：在整个会话里保持一个文件夹的访问授权，并返回普通路径。
- **前端 `src/platform/ios-files.ts`：** 封装插件调用。`src/ipc.ts` 的 `fs` 按路径分流：`file://` 地址（用户选的文件）走插件，其他路径（应用自己的 Documents 目录、所有桌面路径）照旧走 Rust 命令。调用方不区分平台。
- **项目文件夹：** iOS 上 `ai.pickWorkspaceRoot` 选文件夹后调用 `begin_access`，把普通路径交给 Rust。访问授权对整个进程有效，所以 `ai/project.rs` 读取 `.levis/` 和项目文件的代码不用改。
- **配置：**
  - `src-tauri/Info.ios.plist`：让 Documents 目录出现在"文件"应用里，支持就地打开，并为 Markdown 注册"用 Levis 打开"；
  - `capabilities/ios.json`：iOS 上的插件权限；
  - 从"文件"应用打开的文档（`RunEvent::Opened`），在 iOS 上保持 `file://` 地址，走插件读写。

## 构建 iOS（需要 Mac + Xcode）

```sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
brew install xcodegen          # 不手动装的话，tauri ios init 也会尝试自动安装
npm ci
npx tauri ios init             # 生成 src-tauri/gen/apple（不提交到仓库）
npx tauri ios dev              # 在模拟器或真机上运行
npx tauri ios build            # 构建；真机需要在 bundle.iOS.developmentTeam 里配置开发团队
```

CI 里的 `ios` job（`.github/workflows/ci.yml`）跑在 `macos-latest` 上，依次执行 `npx tauri ios init --ci` 和 `npx tauri ios build --ci --debug --target aarch64-sim --no-sign`：为模拟器编译、不签名，也不需要任何 secrets。这个 job 暂时不是必需的 `rust` 检查的依赖。

在 Linux 上只能做 `cargo check`。`ring` 等依赖的 C 代码需要 Apple SDK，可以临时指定一个假的 `CC_aarch64_apple_ios` / `AR_aarch64_apple_ios`，再加一个假的 `xcrun`，绕过 C 编译，专门检查 cfg 隔离写得对不对（不做链接）。

## 尚未处理（Phase 1）

- iOS 布局：标题栏的交通灯留白、触摸交互、安全区（`data-window-chrome="mobile"` 已经留好了样式钩子）。
- 文件访问：沙盒和 security-scoped URL（"在 Levis 中打开"传进来的路径）、iCloud Drive。
- 只剩一个标签时关闭它：iOS 上目前什么都不做（标签保留）。
- `codex_login` / `claude_login` 的 PKCE 流程依赖本地 localhost 回调服务，App 切到后台后能否正常完成，还需要真机验证。
- iOS 上"新文档模式"沿用默认的 window 语义（在当前标签内替换文档），设置项已隐藏。
