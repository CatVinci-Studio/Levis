import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileTree } from "./sidebar/FileTree";
import { Outline } from "./sidebar/Outline";
import { ClipboardHistory } from "./sidebar/ClipboardHistory";
import { ChatHistory } from "./sidebar/ChatHistory";
import {
  TreeTabIcon,
  OutlineTabIcon,
  ClipboardTabIcon,
  ChatTabIcon,
} from "./sidebar/icons";
import { installClipboardCapture } from "./utils/clipboard-history";
import { EditorPane } from "./editor/EditorPane";
import { SettingsPanel } from "./settings/SettingsPanel";
import { useSettings } from "./settings/SettingsContext";
import { useTutorial } from "./onboarding/useTutorial";
import { TutorialExperience } from "./onboarding/TutorialExperience";
import { useTutorialDocumentEvaluation } from "./onboarding/useTutorialDocumentEvaluation";
import { TabBar } from "./TabBar";
import { countWords } from "./utils/word-count";
import { LARGE_DOC_THRESHOLD } from "./editor/large-doc";
import { migrateDraftImages } from "./editor/image-migration";
import { comboFromEvent, formatCombo } from "./utils/shortcuts";
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
  type DocTab,
  type HelpDoc,
} from "./doc-tabs";
import { useTabDragMerge } from "./useTabDragMerge";
import { useDraftAutosave } from "./draft-autosave";
import { useMenuBridge } from "./menu-bridge";
import { useStartupRestore } from "./startup-restore";
import { drafts, fs, session } from "./ipc";
import {
  TRIGGER_COMPLETION_EVENT,
  TRIGGER_GRAMMAR_CHECK_EVENT,
  TOGGLE_FLOATING_CHAT_EVENT,
  TOGGLE_FIND_REPLACE_EVENT,
} from "./utils/events";
import "./App.css";

type PanelMode = "tree" | "outline" | "clipboard" | "chat";

type PendingClose =
  | { kind: "tab"; tabId: string }
  | { kind: "window" }
  | { kind: "replace"; tabId: string; path: string };

// Module-scoped, NOT a ref: React StrictMode (dev builds) runs mount effects
// twice on the same component, which would otherwise steal a tab meant for
// a different recovery pass (symptom: one window gets the wrong tab,
// another goes blank). Module state survives the StrictMode remount;
// separate windows are separate webviews with their own module instance, so
// each window still recovers its practice tab at most once. (The startup
// drain effect - OS-open paths, recovered drafts, etc. - has its own analogous
// guard; see startup-restore.ts's `drained`.)
let tutorialTabRecoveryDone = false;

function App() {
  const { t, settings, setSettings } = useSettings();
  const [tabs, setTabs] = useState<DocTab[]>(() => [makeBlankTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);
  // The one save/discard/cancel prompt, reused for every "this would lose
  // unsaved content" moment: closing a tab, closing the whole window (every
  // dirty tab needs a decision, not just the active one), or replacing the
  // active tab's document in place (window-mode Open File / agent.md).
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>("tree");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const appUpdate = useAppUpdate();
  useZoom(settings.zoom, (zoom) => setSettings({ zoom }));
  const tutorial = useTutorial();
  const startTutorial = tutorial.start;
  const stopTutorial = tutorial.exit;
  const evaluateTutorialDocumentChange = useTutorialDocumentEvaluation(
    tutorial,
    t,
  );
  useDraftAutosave(tabs, settings.enableDraftRecovery);
  const [draftsRestoredCount, setDraftsRestoredCount] = useState(0);

  // Mirrors `tabs` synchronously so callbacks (open/save/close) can read the
  // latest state without depending on - and thus re-creating - on every
  // keystroke, the same pattern the old single-doc dirtyRef used.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  // The tree always mirrors the active tab's folder; with no file open there
  // is nothing to show.
  const rootPath = activeTab.path ? dirname(activeTab.path) : null;
  const wordCount = useMemo(
    () => countWords(activeTab.content),
    [activeTab.content],
  );
  // A markdown-string-length proxy for the same threshold the editor
  // plugins check against the live ProseMirror doc size (see
  // editor/large-doc.ts) - close enough for a status indicator.
  const isLargeDoc = activeTab.content.length > LARGE_DOC_THRESHOLD;
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
    const paths = tabs
      .filter((tab) => tab.path)
      .map((tab) => tab.path as string);
    void session.updateSessionPaths(paths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionPathsKey]);

  const updateTab = useCallback((id: string, patch: Partial<DocTab>) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)),
    );
  }, []);

  const openPathInTab = useCallback(async (path: string) => {
    const existing = tabsRef.current.find((tab) => tab.path === path);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const { content: text, diskMtime } = await readDocFromDisk(path);
    void session.addRecentFile(path); // feeds File > Open Recent
    const newTab = {
      ...makeBlankTab(),
      path,
      content: text,
      savedContent: text,
      diskMtime,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, []);

  // "window" mode's actual replace step, shared between the no-dirty fast
  // path and the save/discard prompt's resolution (2.3: unsaved protection).
  const replaceTabWithFile = useCallback(
    async (tabId: string, path: string) => {
      const { content: text, diskMtime } = await readDocFromDisk(path);
      void session.addRecentFile(path);
      updateTab(tabId, { path, content: text, savedContent: text, diskMtime });
    },
    [updateTab],
  );

  const openFile = useCallback(
    async (path: string) => {
      if (settings.newDocumentMode === "tab") {
        await openPathInTab(path);
        return;
      }
      // "window" mode: replace the active tab's document in place, same as
      // this app has always worked for a single document per window - unless
      // that would silently lose unsaved edits, in which case the same
      // save/discard/cancel prompt used for closing steps in first.
      const activeTab = tabsRef.current.find((tb) => tb.id === activeTabId);
      if (activeTab && tabIsDirty(activeTab)) {
        setPendingClose({ kind: "replace", tabId: activeTabId, path });
        return;
      }
      await replaceTabWithFile(activeTabId, path);
    },
    [settings.newDocumentMode, activeTabId, openPathInTab, replaceTabWithFile],
  );

  const openFileDialog = useCallback(async () => {
    const picked = await fs.openFileDialog();
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
      // Help documents are destinations of their own, never a continuation
      // of an in-progress onboarding run. Without this, a persisted tutorial
      // could remain floating over the Markdown/AI guide after it opens.
      stopTutorial();
      const existing = tabsRef.current.find((tab) => tab.helpDoc === doc);
      if (existing) {
        setActiveTabId(existing.id);
        return;
      }
      const content = helpDocContent(doc, settings.language);
      const tab = {
        ...makeBlankTab(),
        content,
        savedContent: content,
        helpDoc: doc,
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
    },
    [settings.language, stopTutorial],
  );

  // Picks the tour's practice tab WITHOUT opening anything new when it can
  // be avoided: the active tab is reused whenever it's an untouched draft
  // (the first-run case, and usually the Help-menu case too); only when the
  // user is mid-document does a blank tab get appended - typing demos must
  // never land in real content.
  const claimPracticeTab = useCallback((): string => {
    const active = tabsRef.current.find((tb) => tb.id === activeTabId);
    if (active && !active.path && !active.helpDoc && active.content === "")
      return active.id;
    const blank = makeBlankTab();
    setTabs((prev) => [...prev, blank]);
    setActiveTabId(blank.id);
    return blank.id;
  }, [activeTabId]);

  // Starts the onboarding tour - a layer over THIS window (TutorialOverlay),
  // never a separate window or panel. Used by the Help menu item, the
  // no-window pending-help drain, and the fresh-install path alike. Re-arms
  // coach marks too, so relaunching the tour from Help also brings back the
  // "try this" bubbles it would have shown the first time.
  const startWelcomeTutorial = useCallback(() => {
    startTutorial(claimPracticeTab());
  }, [startTutorial, claimPracticeTab]);

  const handleChange = useCallback(
    (tabId: string, markdown: string) => {
      updateTab(tabId, { content: markdown });
      evaluateTutorialDocumentChange(tabId, markdown);
    },
    [updateTab, evaluateTutorialDocumentChange],
  );

  // Resolves true only when the document actually reached disk - the close
  // prompt must not close the window (or remove the tab) when a save-as
  // dialog was cancelled.
  // Always asks where to write, regardless of whether the document already
  // has a path - File > Save As…, and the "first save of a draft" case.
  const saveTabAs = useCallback(
    async (tabId: string): Promise<boolean> => {
      const tab = tabsRef.current.find((tb) => tb.id === tabId);
      if (!tab) return false;
      const picked = await fs.saveFileDialog();
      if (!picked) return false;
      await fs.writeTextFile(picked, tab.content);
      void session.addRecentFile(picked);
      // First save of a draft: any pasted images it holds live in the app's
      // data dir with an absolute src (fs.rs's save_pasted_image) - now that
      // the document has a real home, move them into assets/ next to it and
      // rewrite the markdown to relative paths (4.2). A no-op for documents
      // with no draft-origin images.
      let { content } = tab;
      try {
        const migration = await migrateDraftImages(picked, tab.content);
        if (migration.migrated) {
          content = migration.content;
          await fs.writeTextFile(picked, content);
        }
        if (migration.failed.length > 0) {
          void message(
            `${t.imageMigrationFailedMessage}\n${migration.failed.join("\n")}`,
            {
              title: t.imageMigrationFailedTitle,
              kind: "warning",
            },
          );
        }
      } catch (err) {
        console.error("[image-migration] failed:", err);
      }
      updateTab(tabId, {
        path: picked,
        content,
        savedContent: content,
        diskMtime: await statMtime(picked),
      });
      return true;
    },
    [updateTab, t],
  );

  const saveTab = useCallback(
    async (tabId: string): Promise<boolean> => {
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
      await fs.writeTextFile(tab.path, tab.content);
      updateTab(tabId, {
        savedContent: tab.content,
        diskMtime: await statMtime(tab.path),
      });
      return true;
    },
    [updateTab, saveTabAs, t],
  );

  const toggleSourceMode = useCallback(() => {
    const tab = tabsRef.current.find((tb) => tb.id === activeTabId);
    if (!tab) return;
    // Leaving source mode: force the WYSIWYG editor to remount so it picks
    // up whatever was typed as raw text.
    if (tab.sourceMode)
      updateTab(activeTabId, {
        sourceMode: false,
        reloadKey: tab.reloadKey + 1,
      });
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
      setPendingClose({ kind: "tab", tabId: id });
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
  }, [
    saveTab,
    requestCloseTab,
    activeTabId,
    settings,
    toggleSourceMode,
    setSettings,
  ]);

  useEffect(() => installClipboardCapture(), []);

  // A tutorial left active across a relaunch (app quit mid-tour) has its
  // practice tab gone - it's a pathless draft, never part of session
  // restore (see the update_session_paths effect above) - so its tabId no
  // longer matches anything and the tutorial's orchestration would sit
  // there reacting to nothing forever. Rebind it to a live practice tab
  // (reusing the startup blank tab - see claimPracticeTab) at the same step
  // instead of losing the run.
  useEffect(() => {
    if (tutorialTabRecoveryDone || !tutorial.active) return;
    tutorialTabRecoveryDone = true;
    if (tabsRef.current.some((tab) => tab.id === tutorial.tabId)) return;
    tutorial.rebindTab(claimPracticeTab());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Files handed over by the OS (Finder "Open With" / double-click, or the
  // `levis` CLI command) at launch, recovered drafts, a dragged-in tab, or a
  // Help doc this window was spawned to show - see startup-restore.ts for
  // the actual priority chain. Deliberately runs only once, at mount.
  useStartupRestore({
    activeTabId,
    enableDraftRecovery: settings.enableDraftRecovery,
    newDocumentMode: settings.newDocumentMode,
    language: settings.language,
    onboardingShown: settings.onboardingShown,
    updateTab,
    setTabs,
    setDraftsRestoredCount,
    markOnboardingShown: () => setSettings({ onboardingShown: true }),
    openPathInTab,
    openFile,
    startTutorial,
    stopTutorial,
  });

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
      setPendingClose({ kind: "window" });
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
    const unlisten = getCurrentWindow().onFocusChanged(
      ({ payload: focused }) => {
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
            const content = await fs.readTextFile(tab.path).catch(() => null);
            if (content === null) continue;
            // Re-check against the LIVE tab: the user may have started typing
            // (or the tab may be gone) while the read above was in flight, and
            // clobbering those fresh edits with disk content would lose them.
            const live = tabsRef.current.find((tb) => tb.id === tab.id);
            if (!live || tabIsDirty(live)) continue;
            updateTab(tab.id, {
              content,
              savedContent: content,
              diskMtime: mtime,
              reloadKey: live.reloadKey + 1,
            });
          }
        })().finally(() => {
          checking = false;
        });
      },
    );
    return () => {
      void unlisten.then((f) => f());
    };
  }, [updateTab]);

  // Menu events from Rust (menu.rs's dispatch) - every File/View/Format/Help
  // action the frontend owns arrives here as a window event; see
  // menu-bridge.ts for the actual subscriptions.
  useMenuBridge({
    activeTabId,
    tabsRef,
    t,
    onOpenSettings: () => setSettingsOpen(true),
    onToggleTypewriter: () =>
      setSettings({ typewriterMode: !settings.typewriterMode }),
    onToggleSidebar: () => setPanelOpen((v) => !v),
    addBlankTab,
    openFileDialog,
    saveTab,
    saveTabAs,
    toggleSourceMode,
    requestCloseTab,
    openHelpTab,
    startWelcomeTutorial,
  });

  /** Deletes this window's draft snapshots before the window is destroyed.
   *  Draft cleanup normally rides useDraftAutosave's next effect run (a tab
   *  leaves `tabs`, or turns clean) - but destroy() means there IS no next
   *  run, so a whole-window close must clean up explicitly or the discarded
   *  content comes back as a "restored draft" on the next launch. Per-tab
   *  rather than clearAllDrafts: the draft store is shared by every window,
   *  and other windows' drafts must survive. */
  const clearWindowDrafts = useCallback(async () => {
    await Promise.all(
      tabsRef.current.map((tab) => drafts.clearDraftSnapshot(tab.id)),
    );
  }, []);

  const closeSaving = useCallback(async () => {
    const action = pendingClose;
    setPendingClose(null);
    if (!action) return;
    if (action.kind === "window") {
      // Whole window: save every dirty tab, aborting (leaving the window
      // open) if any of them hits a cancelled Save As.
      for (const tab of tabsRef.current) {
        if (!tabIsDirty(tab)) continue;
        const ok = await saveTab(tab.id);
        if (!ok) return;
      }
      // The just-saved tabs' snapshot cleanup would race destroy() below
      // (it runs on a later effect tick) - do it synchronously instead.
      await clearWindowDrafts();
      await getCurrentWindow().destroy();
    } else if (action.kind === "tab") {
      if (!(await saveTab(action.tabId))) return;
      removeTab(action.tabId);
    } else {
      if (!(await saveTab(action.tabId))) return;
      await replaceTabWithFile(action.tabId, action.path);
    }
  }, [pendingClose, saveTab, removeTab, replaceTabWithFile, clearWindowDrafts]);

  const closeDiscarding = useCallback(async () => {
    const action = pendingClose;
    setPendingClose(null);
    if (!action) return;
    if (action.kind === "window") {
      // "Don't Save" is a decision - the discarded content must not come
      // back as a recovered draft on the next launch.
      await clearWindowDrafts();
      await getCurrentWindow().destroy();
    } else if (action.kind === "tab") removeTab(action.tabId);
    else await replaceTabWithFile(action.tabId, action.path);
  }, [pendingClose, removeTab, replaceTabWithFile, clearWindowDrafts]);

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
                <FileTree
                  rootPath={rootPath}
                  activePath={activeTab.path}
                  onFileSelect={openFile}
                />
              )}
              {panelMode === "outline" && (
                <Outline content={activeTab.content} />
              )}
              {panelMode === "clipboard" && <ClipboardHistory />}
              {panelMode === "chat" && <ChatHistory />}
            </div>
          </>
        )}
      </aside>

      <div className="main-pane">
        {showTabBar && (
          <TabBar
            tabs={tabs.map((tab) => ({
              id: tab.id,
              title: tabTitle(tab, t),
              dirty: tabIsDirty(tab),
            }))}
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
          {activeDirty && (
            <span className="unsaved-dot" title={t.unsavedIndicator} />
          )}
          {isLargeDoc && (
            <span className="large-doc-badge" title={t.largeDocHint}>
              {t.largeDocBadge}
            </span>
          )}
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
                tutorialMock={tutorial.active && tab.id === tutorial.tabId}
              />
            )}
          </div>
        ))}
      </div>

      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          onOpenFile={(path) => void openFile(path)}
        />
      )}

      {pendingClose && (
        <div className="close-prompt-overlay">
          <div className="close-prompt">
            <p>{t.closePromptMessage}</p>
            <div className="close-prompt-buttons">
              <button
                className="close-prompt-discard"
                onClick={() => void closeDiscarding()}
              >
                {t.closePromptDiscard}
              </button>
              <div className="close-prompt-spacer" />
              <button onClick={() => setPendingClose(null)}>
                {t.closePromptCancel}
              </button>
              <button
                className="close-prompt-primary"
                autoFocus
                onClick={() => void closeSaving()}
              >
                {t.closePromptSave}
              </button>
            </div>
          </div>
        </div>
      )}

      {draftsRestoredCount > 0 && (
        <div className="draft-restored-toast">
          <span>{t.draftRestoredMessage}</span>
          <button
            className="update-toast-secondary"
            onClick={() => setDraftsRestoredCount(0)}
          >
            {t.draftRestoredDismiss}
          </button>
        </div>
      )}

      {appUpdate.status !== "idle" && (
        <div className="update-toast">
          {appUpdate.status === "available" && (
            <>
              <span>
                {t.updateAvailable} v{appUpdate.version}
              </span>
              <button
                className="update-toast-primary"
                onClick={() => void appUpdate.install()}
              >
                {t.updateInstall}
              </button>
              <button
                className="update-toast-secondary"
                onClick={appUpdate.dismiss}
              >
                {t.updateLater}
              </button>
            </>
          )}
          {appUpdate.status === "downloading" && (
            <span>{t.updateDownloading}</span>
          )}
          {appUpdate.status === "error" && (
            <>
              <span>
                {t.updateFailed} {appUpdate.error}
              </span>
              <button
                className="update-toast-secondary"
                onClick={appUpdate.dismiss}
              >
                {t.updateLater}
              </button>
            </>
          )}
        </div>
      )}

      {tutorial.active && (
        <TutorialExperience
          tutorial={tutorial}
          t={t}
          shortcuts={{
            completion: formatCombo(settings.shortcuts.triggerCompletion),
            grammar: formatCombo(settings.shortcuts.triggerGrammarCheck),
            agent: formatCombo(settings.shortcuts.toggleFloatingChat),
          }}
        />
      )}
    </div>
  );
}

export default App;
