import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileTree } from "./sidebar/FileTree";
import { Outline } from "./sidebar/Outline";
import { ClipboardHistory } from "./sidebar/ClipboardHistory";
import { installClipboardCapture } from "./utils/clipboard-history";
import { EditorPane } from "./editor/EditorPane";
import { SettingsPanel } from "./settings/SettingsPanel";
import { useSettings } from "./settings/SettingsContext";
import { countWords } from "./utils/word-count";
import { comboFromEvent } from "./utils/shortcuts";
import { useAppUpdate } from "./utils/useAppUpdate";
import { TRIGGER_COMPLETION_EVENT, TRIGGER_GRAMMAR_CHECK_EVENT, TOGGLE_FLOATING_CHAT_EVENT } from "./utils/events";
import "./App.css";

type PanelMode = "tree" | "outline" | "clipboard";

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : path;
}

function App() {
  const { t, settings, setSettings } = useSettings();
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  // What's on disk (or "" for a fresh draft) - dirtiness is divergence from
  // this, and it's what the close-confirmation prompt keys off.
  const [savedContent, setSavedContent] = useState("");
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>("tree");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const appUpdate = useAppUpdate();

  // The tree always mirrors the currently open file's folder; with no file
  // open there is nothing to show.
  const rootPath = activePath ? dirname(activePath) : null;
  const wordCount = useMemo(() => countWords(content), [content]);

  const dirty = content !== savedContent;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const openFile = useCallback(async (path: string) => {
    const text = await invoke<string>("read_text_file", { path });
    setContent(text);
    setSavedContent(text);
    setActivePath(path);
  }, []);

  const openFileDialog = useCallback(async () => {
    const picked = await invoke<string | null>("open_file_dialog");
    if (picked) await openFile(picked);
  }, [openFile]);

  const handleChange = useCallback((markdown: string) => {
    setContent(markdown);
  }, []);

  // Resolves true only when the document actually reached disk - the close
  // prompt must not close the window when the save-as dialog was cancelled.
  const save = useCallback(async (): Promise<boolean> => {
    // Draft never saved before: ask where to put it, then this document
    // graduates into a real file (the sidebar tree picks up its folder).
    if (!activePath) {
      const picked = await invoke<string | null>("save_file_dialog");
      if (!picked) return false;
      await invoke("write_text_file", { path: picked, contents: content });
      setActivePath(picked);
      setSavedContent(content);
      return true;
    }

    await invoke("write_text_file", { path: activePath, contents: content });
    setSavedContent(content);
    return true;
  }, [activePath, content]);

  const toggleSourceMode = useCallback(() => {
    setSourceMode((prev) => {
      // Leaving source mode: force the WYSIWYG editor to remount so it picks
      // up whatever was typed as raw text.
      if (prev) setReloadKey((k) => k + 1);
      return !prev;
    });
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isSave = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s";
      if (isSave) {
        e.preventDefault();
        void save();
        return;
      }

      const combo = comboFromEvent(e);
      if (!combo) return;
      const { shortcuts } = settings;
      if (combo === shortcuts.triggerCompletion) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(TRIGGER_COMPLETION_EVENT));
      } else if (combo === shortcuts.triggerGrammarCheck) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(TRIGGER_GRAMMAR_CHECK_EVENT));
      } else if (combo === shortcuts.toggleFloatingChat) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(TOGGLE_FLOATING_CHAT_EVENT));
      } else if (combo === shortcuts.toggleSidebar) {
        e.preventDefault();
        setPanelOpen((v) => !v);
      } else if (combo === shortcuts.toggleSourceMode) {
        e.preventDefault();
        toggleSourceMode();
      } else if (combo === shortcuts.toggleTypewriterMode) {
        e.preventDefault();
        setSettings({ typewriterMode: !settings.typewriterMode });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save, settings, toggleSourceMode, setSettings]);

  useEffect(() => installClipboardCapture(), []);

  // Files handed over by the OS (Finder "Open With" / double-click): each
  // window claims at most one queued path when it mounts - see lib.rs's
  // PendingOpenPaths for why this is a pull, not an event.
  useEffect(() => {
    void (async () => {
      const pending = await invoke<string | null>("take_pending_open_path");
      if (pending) await openFile(pending);
    })();
  }, [openFile]);

  // Closing with unsaved changes swaps the native close for the
  // save/discard/cancel prompt. Registered once; reads dirtiness through a
  // ref so the listener doesn't churn on every keystroke.
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested((event) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      setClosePromptOpen(true);
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const unlistenSettings = listen("menu-open-settings", () => setSettingsOpen(true));
    const unlistenOpenFile = listen("menu-open-file", () => void openFileDialog());
    const unlistenSaveFile = listen("menu-save-file", () => void save());
    const unlistenSourceMode = listen("menu-toggle-source-mode", () => toggleSourceMode());
    const unlistenTypewriter = listen("menu-toggle-typewriter-mode", () =>
      setSettings({ typewriterMode: !settings.typewriterMode }),
    );
    const unlistenSidebar = listen("menu-toggle-sidebar", () => setPanelOpen((v) => !v));
    return () => {
      void unlistenSettings.then((f) => f());
      void unlistenOpenFile.then((f) => f());
      void unlistenSaveFile.then((f) => f());
      void unlistenSourceMode.then((f) => f());
      void unlistenTypewriter.then((f) => f());
      void unlistenSidebar.then((f) => f());
    };
  }, [openFileDialog, save, toggleSourceMode, settings.typewriterMode, setSettings]);

  const closeSaving = useCallback(async () => {
    setClosePromptOpen(false);
    if (await save()) await getCurrentWindow().destroy();
  }, [save]);

  const closeDiscarding = useCallback(async () => {
    setClosePromptOpen(false);
    await getCurrentWindow().destroy();
  }, []);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${panelOpen ? "" : "sidebar-collapsed"}`}>
        {/* Contents only render while open - a collapsed sidebar is just
            shifted out of view via margin, not unmounted, so without this
            its buttons/tree would stay in the tab order and Tab could land
            focus on them from the editor. */}
        {panelOpen && (
          <>
            <div className="sidebar-header">
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
                  className={`sidebar-tab ${panelMode === "clipboard" ? "sidebar-tab-active" : ""}`}
                  onClick={() => setPanelMode("clipboard")}
                >
                  {t.clipboardTab}
                </button>
              </div>
            </div>
            <div className="sidebar-body">
              {panelMode === "tree" && rootPath && (
                <FileTree rootPath={rootPath} activePath={activePath} onFileSelect={openFile} />
              )}
              {panelMode === "outline" && <Outline content={content} />}
              {panelMode === "clipboard" && <ClipboardHistory />}
            </div>
          </>
        )}
      </aside>

      <div className="main-pane">
        <div className="floating-toolbar">
          {dirty && <span className="unsaved-dot" title={t.unsavedIndicator} />}
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

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      {closePromptOpen && (
        <div className="close-prompt-overlay">
          <div className="close-prompt">
            <p>{t.closePromptMessage}</p>
            <div className="close-prompt-buttons">
              <button className="close-prompt-discard" onClick={() => void closeDiscarding()}>
                {t.closePromptDiscard}
              </button>
              <div className="close-prompt-spacer" />
              <button onClick={() => setClosePromptOpen(false)}>{t.closePromptCancel}</button>
              <button className="close-prompt-primary" autoFocus onClick={() => void closeSaving()}>
                {t.closePromptSave}
              </button>
            </div>
          </div>
        </div>
      )}

      {appUpdate.status !== "idle" && (
        <div className="update-toast">
          {appUpdate.status === "available" && (
            <>
              <span>
                {t.updateAvailable} v{appUpdate.version}
              </span>
              <button className="update-toast-primary" onClick={() => void appUpdate.install()}>
                {t.updateInstall}
              </button>
              <button className="update-toast-secondary" onClick={appUpdate.dismiss}>
                {t.updateLater}
              </button>
            </>
          )}
          {appUpdate.status === "downloading" && <span>{t.updateDownloading}</span>}
          {appUpdate.status === "error" && (
            <>
              <span>
                {t.updateFailed} {appUpdate.error}
              </span>
              <button className="update-toast-secondary" onClick={appUpdate.dismiss}>
                {t.updateLater}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
