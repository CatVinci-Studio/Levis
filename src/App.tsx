import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FileTree } from "./sidebar/FileTree";
import { Outline } from "./sidebar/Outline";
import { EditorPane } from "./editor/EditorPane";
import { SettingsPanel } from "./settings/SettingsPanel";
import { useSettings } from "./settings/SettingsContext";
import { countWords } from "./utils/word-count";
import { AgentPanel } from "./agent/AgentPanel";
import "./App.css";

type PanelMode = "tree" | "outline" | "agent";

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : path;
}

function App() {
  const { t, settings, setSettings } = useSettings();
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>("tree");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // The tree always mirrors the currently open file's folder; with no file
  // open there is nothing to show.
  const rootPath = activePath ? dirname(activePath) : null;
  const wordCount = useMemo(() => countWords(content), [content]);

  const openFile = useCallback(async (path: string) => {
    const text = await invoke<string>("read_text_file", { path });
    setContent(text);
    setActivePath(path);
  }, []);

  async function openFileDialog() {
    const picked = await invoke<string | null>("open_file_dialog");
    if (picked) await openFile(picked);
  }

  const handleChange = useCallback((markdown: string) => {
    setContent(markdown);
  }, []);

  const save = useCallback(async () => {
    // Draft never saved before: ask where to put it, then this document
    // graduates into a real file (the sidebar tree picks up its folder).
    if (!activePath) {
      const picked = await invoke<string | null>("save_file_dialog");
      if (!picked) return;
      await invoke("write_text_file", { path: picked, contents: content });
      setActivePath(picked);
      return;
    }

    await invoke("write_text_file", { path: activePath, contents: content });
  }, [activePath, content]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isSave = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s";
      if (isSave) {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save]);

  const toggleSourceMode = useCallback(() => {
    setSourceMode((prev) => {
      // Leaving source mode: force the WYSIWYG editor to remount so it picks
      // up whatever was typed as raw text.
      if (prev) setReloadKey((k) => k + 1);
      return !prev;
    });
  }, []);

  useEffect(() => {
    const unlistenSettings = listen("menu-open-settings", () => setSettingsOpen(true));
    const unlistenSourceMode = listen("menu-toggle-source-mode", () => toggleSourceMode());
    const unlistenTypewriter = listen("menu-toggle-typewriter-mode", () =>
      setSettings({ typewriterMode: !settings.typewriterMode }),
    );
    const unlistenSidebar = listen("menu-toggle-sidebar", () => setPanelOpen((v) => !v));
    return () => {
      void unlistenSettings.then((f) => f());
      void unlistenSourceMode.then((f) => f());
      void unlistenTypewriter.then((f) => f());
      void unlistenSidebar.then((f) => f());
    };
  }, [toggleSourceMode, settings.typewriterMode, setSettings]);

  return (
    <div className="app-shell">
      <div className="main-pane">
        <div className="floating-toolbar">
          <span className="word-count">
            {wordCount.words > 0 && `${wordCount.words} ${t.wordsUnit}`}
            {wordCount.words > 0 && wordCount.cjkChars > 0 && " · "}
            {wordCount.cjkChars > 0 && `${wordCount.cjkChars} ${t.charsUnit}`}
          </span>
        </div>

        {sourceMode ? (
          <textarea
            className="source-view"
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <EditorPane
            key={`${activePath ?? "untitled"}-${reloadKey}`}
            filePath={activePath}
            initialValue={content}
            onChange={handleChange}
          />
        )}
      </div>

      <aside className={`sidebar ${panelOpen ? "" : "sidebar-collapsed"}`}>
        <div className="sidebar-header">
          <button className="text-button" onClick={openFileDialog}>
            {t.openFile}
          </button>
          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab ${panelMode === "tree" ? "sidebar-tab-active" : ""}`}
              onClick={() => setPanelMode("tree")}
            >
              {t.treeTab}
            </button>
            <button
              className={`sidebar-tab ${panelMode === "outline" ? "sidebar-tab-active" : ""}`}
              onClick={() => setPanelMode("outline")}
            >
              {t.outlineTab}
            </button>
            <button
              className={`sidebar-tab ${panelMode === "agent" ? "sidebar-tab-active" : ""}`}
              onClick={() => setPanelMode("agent")}
            >
              {t.agentTab}
            </button>
          </div>
        </div>
        <div className={`sidebar-body ${panelMode === "agent" ? "sidebar-body-flush" : ""}`}>
          {panelMode === "tree" && rootPath && (
            <FileTree rootPath={rootPath} activePath={activePath} onFileSelect={openFile} />
          )}
          {panelMode === "outline" && <Outline content={content} />}
          {panelMode === "agent" && <AgentPanel document={content} />}
        </div>
      </aside>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export default App;
