# iOS 代码地图

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

方案见 `docs/ios/plan.zh.md` 的"文件访问方案"一节。代码分三处：

- **原生插件 `src-tauri/plugins/levis-files`：** Swift 实现在 `ios/Sources/LevisFilesPlugin.swift`，Rust 部分只做转发，并且只在 iOS 上编译（工作区成员，桌面上是一个空 crate）。提供的方法：
  - 选择文件、选择文件夹；
  - 在授权范围内读写、列目录，读写经过 NSFileCoordinator；
  - 把授权存成 bookmark；启动时 `restoreFolderAccess`（`src/main.tsx`）通过 `remembered` 重新打开之前选过的文件夹，否则重启后 AI 读不到项目文件夹；
  - `begin_access`：在整个会话里保持一个文件夹的访问授权，并返回普通路径；
  - `share`：系统分享面板（见下文"iPhone 界面"）；
  - `read_data`：以 base64 读出授权范围内的文件，用于所选文档旁边的相对路径图片（`scopedImageSrc`，`editor/image-plugin.ts`）。单独选中的文档只授权这一个文件，所以图片要在选中的文件夹里才读得到。
- **前端 `src/platform/ios-files.ts`：** 封装插件调用。从"文件"里选中的、其实位于应用 Documents 目录内的文档，会换回普通路径，避免同一个文件以两种写法打开两次。`src/ipc.ts` 的 `fs` 按路径分流：`file://` 地址（用户选的文件）走插件，其他路径（应用自己的 Documents 目录、所有桌面路径）照旧走 Rust 命令。调用方不区分平台。
- **项目文件夹：** iOS 上 `ai.pickWorkspaceRoot` 选文件夹后调用 `begin_access`，把普通路径交给 Rust。访问授权对整个进程有效，所以 `ai/project.rs` 读取 `.levis/` 和项目文件的代码不用改。
- **配置：**
  - `src-tauri/PrivacyInfo.ios.xcprivacy`：隐私清单，声明 UserDefaults（插件存 bookmark）和文件时间戳（检查文档是否被外部修改）这两类"需要说明理由的 API"，没有它 App Store Connect 会拒收上传。`tauri.conf.json` 管不到它，由 `scripts/ios-prepare.sh` 在 `tauri ios init` 之后复制进工程。必须紧接着 init 运行：之后再跑 xcodegen 会把已构建的库也收进资源，导致 "Multiple commands produce libapp.a"；
  - `src-tauri/Info.ios.plist`：让 Documents 目录出现在"文件"应用里，支持就地打开，并为 Markdown 注册"用 Levis 打开"；
  - `capabilities/ios.json`：iOS 上的插件权限；
  - 从"文件"应用打开的文档（`RunEvent::Opened`），在 iOS 上保持 `file://` 地址，走插件读写。

## 构建 iOS（需要 Mac + Xcode）

```sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
brew install xcodegen          # 不手动装的话，tauri ios init 也会尝试自动安装
npm ci
npx tauri ios init             # 生成 src-tauri/gen/apple（不提交到仓库）
sh scripts/ios-prepare.sh      # 紧接着 init：加入隐私清单，并让 xcodegen 重新生成工程
npx tauri ios dev              # 在模拟器或真机上运行
npx tauri ios build            # 构建；真机需要在 bundle.iOS.developmentTeam 里配置开发团队
```

CI 里的 `ios` job（`.github/workflows/ci.yml`）跑在 `macos-latest` 上，依次执行 `npx tauri ios init --ci`、`scripts/ios-prepare.sh` 和 `npx tauri ios build --ci --debug --target aarch64-sim --no-sign`：为模拟器编译、不签名，也不需要任何 secrets。这个 job 暂时不是必需的 `rust` 检查的依赖。

在 Linux 上只能做 `cargo check`。`ring` 等依赖的 C 代码需要 Apple SDK，可以临时指定一个假的 `CC_aarch64_apple_ios` / `AR_aarch64_apple_ios`，再加一个假的 `xcrun`，绕过 C 编译，专门检查 cfg 隔离写得对不对（不做链接）。

## iPhone 界面

- **样式：** 全部在 `src/mobile/styles/`，由 `index.css` 统一引入（`main.tsx`），桌面样式表不动。规则写在 `index.css` 开头：每条选择器都以 `:root[data-window-chrome="mobile"]` 开头，靠这个前缀的优先级压过桌面规则，不依赖加载顺序（编辑器的样式在懒加载的分包里，比主入口晚到）；对所有触屏（iPhone 和 iPad）都成立的写在顶层，手机形态写在 `@media (max-width: 760px)` 里，和 `usePhoneLayout()` 的宽度一致。按区域分文件：`base.css`（44pt 标题栏、20pt 图标、字体栈——`-apple-system`、`system-ui`、`ui-monospace` 在 iOS 26 WebKit 上会把中日文显示成方框——、16px 输入框、触控不画焦点环、页面背景色铺到状态栏和 Home 指示条下）、`sidebar.css`（抽屉、44pt 行）、`chrome.css`（弹窗、菜单、查找栏、标签栏）、`editor.css`（整块选中用淡淡的主题色底而不是 ProseMirror 自带的 #8cf 蓝框、表格"+"条、代码块语言）、`ai-sheet.css`、`quick-ask-dock.css`、`composer.css`、`settings.css`。只在手机上才有的组件（`ActionSheet`、`PhoneNavBar`、`KeyboardToolbar`、`DocumentList`）的样式放在组件旁边。
- **手机形态的开关：** `mobile/usePhoneLayout.ts`（iOS 且宽度 ≤ 760px）。iPad 宽屏保持桌面的弹出菜单和对话框。
- **选择框：** `ui/Select.tsx` 在 iOS 上是原生 `<select>`（透明地盖在同样外观的按钮上），点开就是系统的选择器。
- **操作表：** `mobile/ActionSheet.tsx`，UIKit 式的底部操作列表，"取消"单独一块。`ContextMenu` 在手机宽度下自动渲染成它，所以文件长按、文档"⋯"、项目文件夹菜单、"保存更改？"都是操作表。
- **菜单：** 标题栏左侧的按钮打开 `buildMobileMenu`（`ui/app-menu-model.ts`）：一列平铺，只有文档操作、查找替换、侧边栏和设置；源码、打字机、禅模式和两个帮助在设置里（编辑与外观 › 视图、通用 › 帮助），通过和菜单项相同的事件切换。iOS 没有 `menu.rs`，所以 `emitMenuEvent`（`ui/app-menu-actions.ts`）把菜单 id 转成 `useMenuBridge` 监听的同名事件发给本窗口。目标必须写成 `WebviewWindow`：只写标签会变成 `AnyLabel`，而 iOS 上窗口和 webview 都叫 main，事件会到两次，开关类操作互相抵消。
- **键盘：** `KeyboardFit.swift`（同在 levis-files 插件里，由插件的 `load(webview:)` 启动）在键盘弹出时把 webview 缩短到键盘上方，并关闭 webview 自身的滚动和回弹；否则 WebKit 会把整页往上推，标题栏被顶出屏幕。页面的静止位置不是 0，而是负的顶部安全区高度（`pinToTop`）；从别的 App 切回来时也会重新校正，否则标题栏和正文会落到状态栏下面。`platform/mobile-viewport.ts` 只设置 `maximum-scale=1`，防止聚焦输入框时页面被放大。
- **存与开：** 新文档"保存"直接写进 Documents，文件名用建议名，重名时加序号（`newDocumentPath`）。文件树没有打开文档时显示 Documents，不提供"上一级"。"新建文件"在 iOS 上新增一个标签（没有窗口可开）。上次打开的文档记在 localStorage，Documents 内的按相对路径记，因为重装和 App Store 更新都会改变容器路径。
- **文档列表：** 菜单最上面的"文档"打开 `mobile/DocumentList.tsx`：打开过的文档按时间列出（`recentIOSDocuments`，最多 30 个，存在 localStorage，Documents 内按相对路径记；第一个就是启动时重新打开的那个）。点一下打开；"⋯"或长按弹出操作：打开、分享、重命名、删除。Levis 文件夹里的文档由 Rust 的 `rename_entry` / `delete_entry`（`commands/documents.rs`，只在 iOS 注册，路径必须在 Documents 之内）处理；从"文件"里单独选的文档只授权了文件本身、没有授权所在文件夹，所以只能打开、分享、从列表移除。重命名后已打开的标签跟着换路径；删除后标签保留内容、变成未保存。
- **分享：** 菜单"分享…"、文档列表和侧边栏文件的长按都调用插件的 `share`：把文档复制到临时目录再弹出系统分享面板（隔空投送、信息、邮件、存储到"文件"），未保存的文档先保存。iOS 的 web view 长按不会触发 contextmenu 事件，所以长按由 `utils/useLongPress.ts` 自己计时。
- **菜单勾选：** 开关类菜单项（侧边栏、源码、打字机、禅模式；桌面 Windows/Linux 的应用内菜单还有 AI 面板、分栏）带 `checked`，开着时显示 ✓（`MenuChecks`，由 App 传入）。手机菜单打开时让编辑器失焦，键盘和系统的"粘贴 | 格式"气泡一起收起，避免盖在菜单上。
- **键盘工具栏：** `mobile/KeyboardToolbar.tsx`，编辑文档时显示在键盘上方：标题、加粗、斜体、列表、引用、代码块，以及"✦ AI"（在光标处打开快速提问，手机上没有快捷键，这是唯一入口）。加粗和斜体是 `md_span` 节点而不是 mark，由 `editor/span-commands.ts` 的 `toggleSpan` 处理。按钮在 touchend 执行并取消默认行为，不抢编辑器的焦点；都是 44pt，放不下时横向滚动。工具栏随光标换内容：在表格里换成加行、加列、删行、删列、删表格（`TABLE_ACTION_EVENT`）；点选图片后换成宽度预设和删除（`IMAGE_ACTION_EVENT`）。最后的"⋯"（`EDITOR_MORE_EVENT`）代替手机上打不开的右键菜单，以动作面板列出右键菜单里工具栏没有的项（`editor-menu.ts` 的 `buildPhoneMoreItems`）。因此手机宽度下隐藏表格的悬停"+"条和图片的拖动手柄，代码块语言选择框放大到 44pt（`mobile/styles/editor.css`）。
- **语法建议：** 手机上没有悬停，点一下下划线（光标落进去，且刚有触摸）弹出动作面板：标题是说明，选项是建议文字和"忽略"；桌面的悬停浮窗不变。
- **AI 底部面板：** 手机宽度下 Levis AI 是底部面板，默认占约 55% 高度，文档仍在上方可见；顶部的拖动条（`AgentPanelSheetGrip`）点一下在半屏和全屏之间切换，往上拖展开，往下拖收起或关闭。iPad 宽屏仍是右侧一栏。
- **快速提问：** 手机宽度下不放进文档（文档里的那块会被键盘挡住，web view 又不能滚），而是停靠在屏幕底部、键盘正上方（`InlineChat` 的 `docked`，样式在 `mobile/styles/quick-ask-dock.css`）：最上面一行引用选中的文字（没有选中时显示"在光标处"），旁边是新对话、转到大对话、关闭（都是 44pt）；中间是回复和采纳/拒绝，最高约 40% 屏幕，可以滚动；最下面是输入框。修改预览仍画在文档里，`mobile/quick-ask-dock.ts` 让文档滚到面板上方。面板打开时键盘工具栏隐藏，由面板占据键盘上方的位置。
- **AI 输入框：** 快速提问和底部面板共用 `ChatComposer`：手机上"询问/编辑/计划"是分段控件，按钮都是 44pt，`/` 技能和 `@` 文件的候选行在 touchend 选中（`mobile/tap.ts`，不抢输入框焦点），点按后不留 :hover（`mobile/styles/composer.css`）。
- **设置：** 和桌面是同一个面板（`settings/SettingsPanel.tsx`），没有单独的手机版页面。每一行都是"名称 + 控件"（`sections/controls.tsx` 的 `SettingRow`），说明文字只留给少数确实需要的行。手机宽度下面板铺满屏幕，分类变成顶部的标签，右上角是"完成"；只改尺寸和布局的样式在 `mobile/styles/settings.css`。分类共五个：通用、编辑与外观、AI、快捷键、隐私；手机上不显示"快捷键"，剩下四个在一屏内排得下。AI 页按"先连接、再功能"排列，每个模型挨着它驱动的功能：连接（服务商、登录与凭据、网络代理、模型列表）→ 写作辅助（续写、语法检查、写作模型）→ Levis AI 对话（开关、对话模型、默认模式、联网搜索）→ 写作要求与技能（工作区文件夹、agent.md、技能、全局配置文件夹）→ 折叠的高级设置；对话关闭时后两组隐藏。模型选择和工作区几行在 `sections/agent.tsx`，服务商和凭据在 `sections/providers.tsx`。界面里 AI 的名字只在 `i18n/strings.ts` 的 `AI_NAME` 定义一次，含这个名字的文案都由它拼出（1.0 改名 Textus 时只改这一行）；设置字段名（`agentModels` 等）保持不变，旧的设置照常读取。手机上关闭设置不会把焦点还给正文（`ui/useModalDialog.ts`），免得键盘重新弹出。
- **AI 补全：** 手机没有 Tab 键，点灰色建议即可采纳（`ghost-text-plugin.ts` 的 `touchend`），设置里的说明文字随之改为"轻点采纳"。
- **首次启动：** 选完语言后不自动进入教程（教程靠键盘快捷键讲解）。
- **测试：** `e2e/phone.spec.ts` 用 Chromium 的手机视口和触摸模拟检查抽屉、全屏 AI 面板和点按采纳；真正的 iOS WebKit 行为（键盘、字体、选文件）在模拟器里用 idb 手动检查过。

## 尚未处理

- `codex_login` / `claude_login` 的 PKCE 流程依赖本地 localhost 回调服务，App 切到后台后能否正常完成，还需要真机验证。
- 粘贴图片到"文件"里选中的文档：`save_pasted_image` 仍按普通路径写在文档旁边，对 `file://` 文档会失败；Documents 里的文档不受影响。
- 只剩一个标签时关闭它：iOS 上目前什么都不做（标签保留）。
