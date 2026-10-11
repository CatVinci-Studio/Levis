import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ChatWindowApp } from "./ai/chat/ChatWindowApp";
import { SettingsProvider } from "./settings/SettingsContext";
import { installDevTauriShim } from "./dev-tauri-shim";
import { publishWindowChrome } from "./ui/window-chrome";
import { WindowEdges } from "./ui/WindowEdges";
import { installWebviewGuards } from "./ui/webview-guards";
import { restoreFolderAccess } from "./platform/ios-files";
import { installMobileViewport } from "./platform/mobile-viewport";
import "./ui/mobile.css";

installDevTauriShim();
installWebviewGuards();
// iOS: reopen the folders picked in earlier sessions (a no-op elsewhere).
void restoreFolderAccess().catch(() => {});

// Before the first render: the stylesheet keys the title row's insets off
// this, and correcting it afterwards would paint the row at the macOS
// traffic-light inset for a frame on every Windows launch.
publishWindowChrome();
installMobileViewport();

// Which view this window is. One bundle serves both: a second HTML entry
// point would mean a second build target and a second copy of the shared
// providers, for a window that reuses most of the app anyway. See
// commands/chat_window.rs, which opens the detached chat with this query.
const view = new URLSearchParams(window.location.search).get("view");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SettingsProvider>
      {view === "chat" ? <ChatWindowApp /> : <App />}
      <WindowEdges />
    </SettingsProvider>
  </React.StrictMode>,
);
