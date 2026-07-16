import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileTree } from "./sidebar/FileTree";
import { Outline } from "./sidebar/Outline";
import { ClipboardHistory } from "./sidebar/ClipboardHistory";
import { ChatHistory } from "./sidebar/ChatHistory";
import { TreeTabIcon, OutlineTabIcon, ClipboardTabIcon, ChatTabIcon } from "./sidebar/icons";
import { installClipboardCapture } from "./utils/clipboard-history";
import { EditorPane } from "./editor/EditorPane";
import { SettingsPanel } from "./settings/SettingsPanel";
import { useSettings, isFreshInstall } from "./settings/SettingsContext";
import { useTutorial } from "./onboarding/useTutorial";
import { TutorialCard } from "./onboarding/TutorialCard";
import { resetCoachMarks } from "./onboarding/coach-marks";
import { TabBar } from "./TabBar";
import { countWords } from "./utils/word-count";
import { comboFromEvent } from "./utils/shortcuts";
import { useAppUpdate } from "./utils/useAppUpdate";
import { useZoom } from "./utils/useZoom";
import { dirname } from "./utils/path";
import {
  helpDocContent,
  makeBlankTab,
  readDocFromDisk,
  statMtime,
  tabIsDirty,
  tabTitle,
  type DetachedTabDoc,
  type DocTab,
  type HelpDoc,
} from "./doc-tabs";
import { exportHtml, exportViaPandoc } from "./export-doc";
import { useTabDragMerge } from "./useTabDragMerge";
import {
  TRIGGER_COMPLETION_EVENT,
  TRIGGER_GRAMMAR_CHECK_EVENT,
  TOGGLE_FLOATING_CHAT_EVENT,
  TOGGLE_FIND_REPLACE_EVENT,
  INSERT_BLOCK_EVENT,
} from "./utils/events";
import "./App.css";

type PanelMode = "tree" | "outline" | "clipboard" | "chat";

// Module-scoped, NOT a ref: React StrictMode (dev builds) runs mount
// effects twice on the same component, and the OS-open drain below is a
// destructive pull from a shared Rust-side queue - a second run steals
// paths meant for other windows (symptom: one window gets the wrong file,
// another goes blank). Module state survives the StrictMode remount;
// separate windows are separate webviews with their own module instance,
// so each window still drains exactly once.
let openQueueDrained = false;

function App() {
  const { t, settings, setSettings } = useSettings();
  const [tabs, setTabs] = useState<DocTab[]>(() => [makeBlankTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);
  // closePromptTabId === null means "closing the whole window" (every dirty
  // tab needs a save/discard decision); otherwise it's the one tab whose ×
  // button triggered the prompt.
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [closePromptTabId, setClosePromptTabId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>("tree");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const appUpdate = useAppUpdate();
  useZoom(settings.zoom, (zoom) => setSettings({ zoom }));
  const tutorial = useTutorial();

  // Mirrors `tabs` synchronously so callbacks (open/save/close) can read the
  // latest state without depending on - and thus re-creating - on every
  // keystroke, the same pattern the old single-doc dirtyRef used.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  // The tree always mirrors the active tab's folder; with no file open there
  // is nothing to show.
  const rootPath = activeTab.path ? dirname(activeTab.path) : null;
  const wordCount = useMemo(() => countWords(activeTab.content), [activeTab.content]);
  const activeDirty = tabIsDirty(activeTab);
  const anyDirty = tabs.some(tabIsDirty);
  const anyDirtyRef = useRef(anyDirty);
  anyDirtyRef.current = anyDirty;

  // Reports this window's on-disk tab paths to Rust so a relaunch (an app
  // update, a crash, or just quitting and reopening) can restore what was
  // open - see commands/session.rs. Untitled/unsaved tabs have no path and
  // are simply skipped; keyed on the joined path list (not `tabs` itself) so
  // content edits don't spam the round trip.
  const sessionPathsKey = tabs.map((tab) => tab.path ?? "").join("\n");
  useEffect(() => {
    const paths = tabs.filter((tab) => tab.path).map((tab) => tab.path as string);
    void invoke("update_session_paths", { paths });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionPathsKey]);

  const updateTab = useCallback((id: string, patch: Partial<DocTab>) => {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  }, []);

  const openPathInTab = useCallback(async (path: string) => {
    const existing = tabsRef.current.find((tab) => tab.path === path);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const { content: text, diskMtime } = await readDocFromDisk(path);
    void invoke("add_recent_file", { path }); // feeds File > Open Recent
    const newTab = { ...makeBlankTab(), path, content: text, savedContent: text, diskMtime };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, []);

  const openFile = useCallback(
    async (path: string) => {
      if (settings.newDocumentMode === "tab") {
        await openPathInTab(path);
        return;
      }
      // "window" mode: replace the active tab's document in place, same as
      // this app has always worked for a single document per window.
      const { content: text, diskMtime } = await readDocFromDisk(path);
      void invoke("add_recent_file", { path });
      updateTab(activeTabId, { path, content: text, savedContent: text, diskMtime });
    },
    [settings.newDocumentMode, activeTabId, openPathInTab, updateTab],
  );

  const openFileDialog = useCallback(async () => {
    const picked = await invoke<string | null>("open_file_dialog");
    if (picked) await openFile(picked);
  }, [openFile]);

  // Within-bar drag-to-reorder (TabBar.tsx): put tab `id` at `index`
  // among the remaining tabs.
  const reorderTab = useCallback((id: string, index: number) => {
    setTabs((prev) => {
      const moved = prev.find((tab) => tab.id === id);
      if (!moved) return prev;
      const rest = prev.filter((tab) => tab.id !== id);
      rest.splice(index, 0, moved);
      return rest;
    });
  }, []);

  const addBlankTab = useCallback(() => {
    const blank = makeBlankTab();
    setTabs((prev) => [...prev, blank]);
    setActiveTabId(blank.id);
  }, []);

  // Help menu docs (Markdown Guide / AI Agent Guide): bundled documents (per
  // UI language), opened as clean pathless drafts - play with them freely,
  // close without saving. savedContent === content so they start non-dirty.
  const openHelpTab = useCallback(
    (doc: HelpDoc) => {
      const existing = tabsRef.current.find((tab) => tab.helpDoc === doc);
      if (existing) {
        setActiveTabId(existing.id);
        return;
      }
      const content = helpDocContent(doc, settings.language);
      const tab = { ...makeBlankTab(), content, savedContent: content, helpDoc: doc };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
    },
    [settings.language],
  );

  // Opens the welcome doc and (re)starts the step-by-step tutorial - the
  // pairing used by first-run, the Help menu item, and the no-window
  // pending-help drain alike, so none of them can open the doc without the
  // tutorial or vice versa. Re-arms coach marks too, so relaunching the
  // tour from Help also brings back the "try this" bubbles it would have
  // shown the first time.
  const startWelcomeTutorial = useCallback(() => {
    openHelpTab("welcome");
    resetCoachMarks();
    tutorial.start();
  }, [openHelpTab, tutorial.start]);

  const handleChange = useCallback(
    (tabId: string, markdown: string) => {
      updateTab(tabId, { content: markdown });
    },
    [updateTab],
  );

  // Resolves true only when the document actually reached disk - the close
  // prompt must not close the window (or remove the tab) when a save-as
  // dialog was cancelled.
  // Always asks where to write, regardless of whether the document already
  // has a path - File > Save As…, and the "first save of a draft" case.
  const saveTabAs = useCallback(async (tabId: string): Promise<boolean> => {
    const tab = tabsRef.current.find((tb) => tb.id === tabId);
    if (!tab) return false;
    const picked = await invoke<string | null>("save_file_dialog");
    if (!picked) return false;
    await invoke("write_text_file", { path: picked, contents: tab.content });
    void invoke("add_recent_file", { path: picked });
    updateTab(tabId, { path: picked, savedContent: tab.content, diskMtime: await statMtime(picked) });
    return true;
  }, [updateTab]);

  const saveTab = useCallback(async (tabId: string): Promise<boolean> => {
    const tab = tabsRef.current.find((tb) => tb.id === tabId);
    if (!tab) return false;
    // Draft never saved before: ask where to put it, then this document
    // graduates into a real file (the sidebar tree picks up its folder).
    if (!tab.path) return saveTabAs(tabId);
    // The file changed on disk since it was read (another app, git, a sync
    // service): saving now would silently destroy those changes, so ask.
    // A null current mtime means the file was deleted - writing simply
    // recreates it, nothing to protect.
    if (tab.diskMtime !== null) {
      const current = await statMtime(tab.path);
      if (current !== null && current !== tab.diskMtime) {
        const overwrite = await ask(t.fileChangedOnDiskMessage, {
          title: t.fileChangedOnDiskTitle,
          okLabel: t.fileChangedOnDiskOverwrite,
          cancelLabel: t.closePromptCancel,
        });
        if (!overwrite) return false;
      }
    }
    await invoke("write_text_file", { path: tab.path, contents: tab.content });
    updateTab(tabId, { savedContent: tab.content, diskMtime: await statMtime(tab.path) });
    return true;
  }, [updateTab, saveTabAs, t]);

  const toggleSourceMode = useCallback(() => {
    const tab = tabsRef.current.find((tb) => tb.id === activeTabId);
    if (!tab) return;
    // Leaving source mode: force the WYSIWYG editor to remount so it picks
    // up whatever was typed as raw text.
    if (tab.sourceMode) updateTab(activeTabId, { sourceMode: false, reloadKey: tab.reloadKey + 1 });
    else updateTab(activeTabId, { sourceMode: true });
  }, [activeTabId, updateTab]);

  // Removes a tab outright (no prompt - callers that need one show it
  // first). Closing the last tab closes the window; closing the active tab
  // hands focus to its right-hand neighbor, or the new last tab.
  const removeTab = useCallback((id: string) => {
    const closedIndex = tabsRef.current.findIndex((tb) => tb.id === id);
    setTabs((prev) => {
      const next = prev.filter((tb) => tb.id !== id);
      if (next.length === 0) {
        void getCurrentWindow().destroy();
        return prev;
      }
      return next;
    });
    setActiveTabId((prevActive) => {
      if (prevActive !== id) return prevActive;
      const remaining = tabsRef.current.filter((tb) => tb.id !== id);
      if (remaining.length === 0) return prevActive;
      return remaining[Math.min(closedIndex, remaining.length - 1)].id;
    });
  }, []);

  const requestCloseTab = useCallback(
    (id: string) => {
      const tab = tabsRef.current.find((tb) => tb.id === id);
      if (!tab || !tabIsDirty(tab)) {
        removeTab(id);
        return;
      }
      setClosePromptTabId(id);
      setClosePromptOpen(true);
    },
    [removeTab],
  );

  // Tabs moving BETWEEN windows, in both directions (drag out, drop in,
  // hover preview) - see useTabDragMerge.ts.
  const { dragHoverPreview, handleTabDetach } = useTabDragMerge({
    tabsRef,
    t,
    removeTab,
    setTabs,
    setActiveTabId,
  });

  // Nothing to switch between with a single tab, regardless of
  // newDocumentMode - the setting only decides how NEW documents open, not
  // whether the bar shows. A single-tab window stays draggable-to-merge via
  // its native title bar instead (see useTabDragMerge.ts) - but the bar
  // still needs to appear the moment an incoming-tab preview lands, so the
  // incoming tab has somewhere to show up before the merge actually happens.
  const showTabBar = tabs.length > 1 || dragHoverPreview !== null;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isSave = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s";
      if (isSave) {
        e.preventDefault();
        void saveTab(activeTabId);
        return;
      }

      const combo = comboFromEvent(e);
      if (!combo) return;

      // Fixed OS-convention shortcut like Cmd+S above, not a configurable
      // settings.shortcuts entry - it mirrors the File > Close Tab menu
      // accelerator. (Close Window keeps its native Cmd+Shift+W.)
      if (combo === "mod+w") {
        e.preventDefault();
        requestCloseTab(activeTabId);
        return;
      }
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
      } else if (combo === shortcuts.findReplace) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(TOGGLE_FIND_REPLACE_EVENT));
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
  }, [saveTab, requestCloseTab, activeTabId, settings, toggleSourceMode, setSettings]);

  useEffect(() => installClipboardCapture(), []);

  // Files handed over by the OS (Finder "Open With" / double-click, or the
  // `levis` CLI command) at launch: in "window" mode each window claims at
  // most one queued path when it mounts, same as this app has always worked
  // (see lib.rs's PendingOpenPaths for why this is a pull, not an event); in
  // "tab" mode this window instead drains every queued path at once and
  // opens them all as tabs. Deliberately runs only once, at mount.
  useEffect(() => {
    if (openQueueDrained) return;
    openQueueDrained = true;
    void (async () => {
      // A tab dragged out of another window's tab bar (see TabBar.tsx /
      // detachTab): claims priority over the OS-open drain below since this
      // window was created specifically to receive it.
      const detached = await invoke<DetachedTabDoc | null>("take_detached_tab");
      if (detached) {
        updateTab(activeTabId, detached);
        return;
      }
      // A Help menu doc clicked with no window open: this window was
      // spawned to show it, so the bundled document rides the blank
      // initial tab instead of opening next to it. "welcome" additionally
      // starts the tutorial, same as clicking the Help menu item directly
      // would (see startWelcomeTutorial).
      const helpDoc = await invoke<string | null>("take_pending_show_help");
      if (helpDoc === "markdown" || helpDoc === "agent" || helpDoc === "welcome") {
        const content = helpDocContent(helpDoc, settings.language);
        updateTab(activeTabId, { content, savedContent: content, helpDoc });
        if (helpDoc === "welcome") {
          resetCoachMarks();
          tutorial.start();
        }
        return;
      }
      if (settings.newDocumentMode === "tab") {
        const paths = await invoke<string[]>("take_pending_open_paths");
        if (paths.length > 0) {
          const [first, ...rest] = paths;
          const { content: text, diskMtime } = await readDocFromDisk(first);
          updateTab(activeTabId, { path: first, content: text, savedContent: text, diskMtime });
          for (const p of rest) await openPathInTab(p);
          return;
        }
      } else {
        const pending = await invoke<string | null>("take_pending_open_path");
        if (pending) {
          await openFile(pending);
          return;
        }
      }
      // Nothing else claimed the initial blank tab - on a genuinely fresh
      // install (never saved a settings blob before this run - see
      // isFreshInstall), that's the tutorial's cue. onboardingShown is the
      // belt-and-suspenders half: it survives even if this window closes
      // mid-tutorial, so a relaunch doesn't restart the tour from scratch.
      if (isFreshInstall && !settings.onboardingShown) {
        const content = helpDocContent("welcome", settings.language);
        updateTab(activeTabId, { content, savedContent: content, helpDoc: "welcome" });
        resetCoachMarks();
        tutorial.start();
        setSettings({ onboardingShown: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Runtime counterpart to the mount-time drain above: Finder "Open With"/
  // the CLI on an already-running instance, while in "tab" mode, arrives as
  // a push instead (see lib.rs's queue_paths_to_open).
  useEffect(() => {
    const unlisten = listen<string[]>("open-paths-as-tabs", async (event) => {
      for (const p of event.payload) await openPathInTab(p);
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, [openPathInTab]);

  // Closing with unsaved changes swaps the native close for the
  // save/discard/cancel prompt, scoped to the whole window (every dirty tab
  // needs a decision, not just the active one). Registered once; reads
  // dirtiness through a ref so the listener doesn't churn on every keystroke.
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested((event) => {
      if (!anyDirtyRef.current) return;
      event.preventDefault();
      setClosePromptTabId(null);
      setClosePromptOpen(true);
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  // External-change pickup: whenever this window regains focus, compare each
  // on-disk tab's live mtime against the snapshot taken at read/save time.
  // Clean tabs silently reload (reloadKey remounts the editor on the new
  // content); dirty tabs are left alone - their unsaved edits stay, and the
  // conflict surfaces as saveTab's overwrite prompt instead. A tab with no
  // snapshot (its mtime was unreadable when the document was read) just
  // adopts the current mtime as its baseline.
  useEffect(() => {
    let checking = false;
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused || checking) return;
      checking = true;
      void (async () => {
        for (const tab of tabsRef.current) {
          if (!tab.path) continue;
          const mtime = await statMtime(tab.path);
          // Deleted or unreadable: keep the buffer as-is; Save recreates it.
          if (mtime === null) continue;
          if (tab.diskMtime === null) {
            updateTab(tab.id, { diskMtime: mtime });
            continue;
          }
          if (mtime === tab.diskMtime) continue;
          if (tabIsDirty(tab)) continue; // dirty: defer to the save-time prompt
          const content = await invoke<string>("read_text_file", { path: tab.path }).catch(() => null);
          if (content === null) continue;
          // Re-check against the LIVE tab: the user may have started typing
          // (or the tab may be gone) while the read above was in flight, and
          // clobbering those fresh edits with disk content would lose them.
          const live = tabsRef.current.find((tb) => tb.id === tab.id);
          if (!live || tabIsDirty(live)) continue;
          updateTab(tab.id, { content, savedContent: content, diskMtime: mtime, reloadKey: live.reloadKey + 1 });
        }
      })().finally(() => {
        checking = false;
      });
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, [updateTab]);

  // Menu events from Rust (menu.rs's dispatch) - every File/View/Format/Help
  // action the frontend owns arrives here as a window event.
  useEffect(() => {
    const activeTabNow = () => tabsRef.current.find((tb) => tb.id === activeTabId);
    const unlistenSettings = listen("menu-open-settings", () => setSettingsOpen(true));
    // Only arrives in tab mode - in window mode the Rust menu handler opens
    // a fresh window itself instead of emitting this.
    const unlistenNewFile = listen("menu-new-file", () => addBlankTab());
    const unlistenOpenFile = listen("menu-open-file", () => void openFileDialog());
    const unlistenSaveFile = listen("menu-save-file", () => void saveTab(activeTabId));
    const unlistenSaveFileAs = listen("menu-save-file-as", () => void saveTabAs(activeTabId));
    // Hands off to the system print panel (WKWebView on macOS supports
    // window.print() natively), which has "Save as PDF" built in - no PDF
    // rendering of our own needed. .printable-content in App.css hides
    // everything but the editor content while the panel is open.
    const unlistenExportPdf = listen("menu-export-pdf", () => window.print());
    const unlistenExportHtml = listen("menu-export-html", () => {
      const tab = activeTabNow();
      if (tab) void exportHtml(tab, t);
    });
    // Payload is the pandoc writer name (docx, epub, ...) from the menu id.
    const unlistenExportPandoc = listen<string>("menu-export-pandoc", (event) => {
      const tab = activeTabNow();
      if (tab) void exportViaPandoc(tab, event.payload, t);
    });
    const unlistenSourceMode = listen("menu-toggle-source-mode", () => toggleSourceMode());
    const unlistenTypewriter = listen("menu-toggle-typewriter-mode", () =>
      setSettings({ typewriterMode: !settings.typewriterMode }),
    );
    const unlistenSidebar = listen("menu-toggle-sidebar", () => setPanelOpen((v) => !v));
    const unlistenFindReplace = listen("menu-find-replace", () =>
      window.dispatchEvent(new CustomEvent(TOGGLE_FIND_REPLACE_EVENT)),
    );
    const unlistenCloseTab = listen("menu-close-tab", () => requestCloseTab(activeTabId));
    // Payload is the block kind (h1..h6, bullet-list, ...) from the menu id -
    // relayed to whichever editor is mounted as active (see MilkdownEditor.tsx).
    const unlistenInsertBlock = listen<string>("menu-insert-block", (event) => {
      window.dispatchEvent(new CustomEvent(INSERT_BLOCK_EVENT, { detail: event.payload }));
    });
    const unlistenHelp = listen<string>("menu-open-help", (event) => {
      if (event.payload === "welcome") startWelcomeTutorial();
      else if (event.payload === "markdown" || event.payload === "agent") openHelpTab(event.payload);
    });
    return () => {
      void unlistenSettings.then((f) => f());
      void unlistenNewFile.then((f) => f());
      void unlistenOpenFile.then((f) => f());
      void unlistenSaveFile.then((f) => f());
      void unlistenSaveFileAs.then((f) => f());
      void unlistenExportPdf.then((f) => f());
      void unlistenExportHtml.then((f) => f());
      void unlistenExportPandoc.then((f) => f());
      void unlistenSourceMode.then((f) => f());
      void unlistenTypewriter.then((f) => f());
      void unlistenSidebar.then((f) => f());
      void unlistenFindReplace.then((f) => f());
      void unlistenCloseTab.then((f) => f());
      void unlistenInsertBlock.then((f) => f());
      void unlistenHelp.then((f) => f());
    };
  }, [
    openFileDialog,
    saveTab,
    saveTabAs,
    addBlankTab,
    openHelpTab,
    startWelcomeTutorial,
    requestCloseTab,
    activeTabId,
    toggleSourceMode,
    settings.typewriterMode,
    setSettings,
    t,
  ]);

  const closeSaving = useCallback(async () => {
    const tabId = closePromptTabId;
    setClosePromptOpen(false);
    if (tabId === null) {
      // Whole window: save every dirty tab, aborting (leaving the window
      // open) if any of them hits a cancelled Save As.
      for (const tab of tabsRef.current) {
        if (!tabIsDirty(tab)) continue;
        const ok = await saveTab(tab.id);
        if (!ok) return;
      }
      await getCurrentWindow().destroy();
    } else {
      if (!(await saveTab(tabId))) return;
      removeTab(tabId);
    }
  }, [closePromptTabId, saveTab, removeTab]);

  const closeDiscarding = useCallback(async () => {
    const tabId = closePromptTabId;
    setClosePromptOpen(false);
    if (tabId === null) await getCurrentWindow().destroy();
    else removeTab(tabId);
  }, [closePromptTabId, removeTab]);

  return (
    <div className="app-shell">
      {/* The overlay title bar hides the native drag area behind the webview,
          so an explicit drag region is required for the window to be movable. */}
      <div className="titlebar-drag-region" data-tauri-drag-region>
        {/* No tab bar to show the filename otherwise (single-tab window) -
            also doubles as the handle for the whole-window drag-to-merge
            gesture (see useTabDragMerge.ts), so knowing which document is
            in which window while dragging actually matters. */}
        {!showTabBar && (
          <span className="titlebar-filename">{tabTitle(activeTab, t)}</span>
        )}
      </div>
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
                  title={t.treeTab}
                  aria-label={t.treeTab}
                >
                  <TreeTabIcon />
                </button>
                <button
                  className={`sidebar-tab ${panelMode === "outline" ? "sidebar-tab-active" : ""}`}
                  onClick={() => setPanelMode("outline")}
                  title={t.outlineTab}
                  aria-label={t.outlineTab}
                >
                  <OutlineTabIcon />
                </button>
                <button
                  className={`sidebar-tab ${panelMode === "clipboard" ? "sidebar-tab-active" : ""}`}
                  onClick={() => setPanelMode("clipboard")}
                  title={t.clipboardTab}
                  aria-label={t.clipboardTab}
                >
                  <ClipboardTabIcon />
                </button>
                <button
                  className={`sidebar-tab ${panelMode === "chat" ? "sidebar-tab-active" : ""}`}
                  onClick={() => setPanelMode("chat")}
                  title={t.chatTab}
                  aria-label={t.chatTab}
                >
                  <ChatTabIcon />
                </button>
              </div>
            </div>
            <div className="sidebar-body">
              {panelMode === "tree" && rootPath && (
                <FileTree rootPath={rootPath} activePath={activeTab.path} onFileSelect={openFile} />
              )}
              {panelMode === "outline" && <Outline content={activeTab.content} />}
              {panelMode === "clipboard" && <ClipboardHistory />}
              {panelMode === "chat" && <ChatHistory />}
            </div>
          </>
        )}
      </aside>

      <div className="main-pane">
        {showTabBar && (
          <TabBar
            tabs={tabs.map((tab) => ({ id: tab.id, title: tabTitle(tab, t), dirty: tabIsDirty(tab) }))}
            activeTabId={activeTabId}
            onActivate={setActiveTabId}
            onClose={requestCloseTab}
            onAdd={addBlankTab}
            onDetach={handleTabDetach}
            onReorder={reorderTab}
            previewTab={dragHoverPreview}
          />
        )}

        <div className="floating-toolbar">
          {activeDirty && <span className="unsaved-dot" title={t.unsavedIndicator} />}
          <span className="word-count">
            {wordCount.words > 0 && `${wordCount.words} ${t.wordsUnit}`}
          </span>
        </div>

        {/* Every open tab's editor stays mounted (just hidden) so switching
            tabs preserves undo history, scroll position, and in-flight AI
            state - only the active one is ever unmounted-on-purpose (via
            reloadKey, when leaving source mode). */}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            data-active-tab={tab.id === activeTabId}
            style={{ display: tab.id === activeTabId ? "contents" : "none" }}
          >
            {tab.sourceMode ? (
              <textarea
                className="source-view"
                value={tab.content}
                onChange={(e) => handleChange(tab.id, e.target.value)}
                spellCheck={false}
              />
            ) : (
              <EditorPane
                key={`${tab.id}-${tab.reloadKey}`}
                filePath={tab.path}
                initialValue={tab.content}
                onChange={(md) => handleChange(tab.id, md)}
              />
            )}
          </div>
        ))}
      </div>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} onOpenFile={(path) => void openFile(path)} />}

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

      {tutorial.active && (
        <TutorialCard
          stepIndex={tutorial.stepIndex}
          totalSteps={tutorial.totalSteps}
          title={t[tutorial.step.titleKey]}
          body={t[tutorial.step.bodyKey]}
          labels={{
            stepOfCount: t.tutorialStepOfCount,
            back: t.tutorialBack,
            next: t.tutorialNext,
            finish: t.tutorialFinish,
            skip: t.tutorialSkip,
          }}
          onNext={tutorial.next}
          onBack={tutorial.back}
          onSkip={tutorial.skip}
        />
      )}
    </div>
  );
}

export default App;
