import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ChatWindowApp } from "./ai/chat/ChatWindowApp";
import { SettingsProvider } from "./settings/SettingsContext";
import { installDevTauriShim } from "./dev-tauri-shim";

installDevTauriShim();

// Which view this window is. One bundle serves both: a second HTML entry
// point would mean a second build target and a second copy of the shared
// providers, for a window that reuses most of the app anyway. See
// commands/chat_window.rs, which opens the detached chat with this query.
const view = new URLSearchParams(window.location.search).get("view");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SettingsProvider>
      {view === "chat" ? <ChatWindowApp /> : <App />}
    </SettingsProvider>
  </React.StrictMode>,
);
