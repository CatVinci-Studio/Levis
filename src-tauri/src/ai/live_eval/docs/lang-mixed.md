# Textus 迁移复盘

三月份我们把 editor 从 Electron 迁移到了 Tauri，目标是减小安装包体积并加快冷启动。

## 过程

在整个迁移的过程当中，我们首先花了大约两周的时间把所有的 IPC 调用都逐一梳理了一遍，然后又把原本依赖 Node.js API 的那些模块一个一个地改写成 Rust command，与此同时还要保证 CI pipeline 在 macOS、Windows 和 Linux 三个平台上都能够正常地跑通，这个过程比我们一开始预想的要复杂得多。

## 结果

安装包从 180 MB 降到了 12 MB，冷启动时间从 2.1 秒降到 0.6 秒。最大的问题是 Linux 上 WebKitGTK 的渲染和 Chromium 不一致。

下一步我们会给 WebView 加上视觉回归测试。