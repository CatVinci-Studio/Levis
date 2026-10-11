import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
} from "./ui/icons";
import { AppMenuButton, WindowCaptionButtons } from "./ui/WindowControls";
import { installClipboardCapture } from "./utils/clipboard-history";
import { EditorPane } from "./editor/EditorPane";
import { flushEditor } from "./editor/editor-flush";
import { isMacPlatform } from "./utils/platform";
import { SettingsPanel } from "./settings/SettingsPanel";
import { useSettings } from "./settings/SettingsContext";
import { useTutorial } from "./onboarding/useTutorial";
import { TutorialExperience } from "./onboarding/TutorialExperience";
import { SIDEBAR_TAB } from "./onboarding/tutorial-evaluation";
import { LanguageWelcome } from "./onboarding/LanguageWelcome";
import { useTutorialDocumentEvaluation } from "./onboarding/useTutorialDocumentEvaluation";
import { TabBar } from "./TabBar";
import { countWords } from "./utils/word-count";
import { LARGE_DOC_THRESHOLD } from "./editor/large-doc";
import { migrateDraftImages } from "./editor/image-migration";
import { formatCombo } from "./utils/shortcuts";
import { useAppUpdate } from "./utils/useAppUpdate";
import { useZoom } from "./utils/useZoom";
import {
  applyTextareaCaret,
  captureEditorCaret,
  readTextareaCaret,
  setPendingCaret,
  takePendingCaret,
} from "./editor/mode-switch";
import { listenToThisWindow, unlistenAll } from "./utils/tauri-events";
import { basename, dirname } from "./utils/path";
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
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { useExternalChangeReload } from "./useExternalChangeReload";
import { useDraftAutosave } from "./draft-autosave";
import { useMenuBridge } from "./menu-bridge";
import { useStartupRestore } from "./startup-restore";
import { drafts, fs, session } from "./ipc";
import { defaultMarkdownFilename } from "./save-default-name";
import { useModalDialog } from "./ui/useModalDialog";
import { SplitView } from "./editor/SplitView";
import { SourceTextarea } from "./editor/SourceTextarea";
import { useWindowEvent } from "./utils/useWindowEvent";
import { OPEN_FILE_IN_TAB_EVENT, ZEN_MODE_EVENT } from "./utils/events";
import {
  AgentPanelProvider,
  AgentPanelResizer,
  useAgentPanelState,
} from "./ai/chat/agent-panel";
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
  const toggleSidebar = useCallback(() => setPanelOpen((v) => !v), []);
  // The docked Agent panel on the right (ai/chat/agent-panel.tsx). App owns
  // the frame; the active tab's editor renders its conversation into it.
  const agentPanel = useAgentPanelState();
  const [agentPanelEl, setAgentPanelEl] = useState<HTMLElement | null>(null);
  const toggleAgentPanel = agentPanel.toggle;
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
  const cancelDraftFlushes = useDraftAutosave(
    tabs,
    settings.enableDraftRecovery,
  );
  const [draftsRestoredCount, setDraftsRestoredCount] = useState(0);

  // Mirrors `tabs` synchronously so callbacks (open/save/close) can read the
  // latest state without depending on - and thus re-creating - on every
  // keystroke.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // tabsRef with every editor's still-debounced edit pulled in (see
  // editor-flush.ts). Anything that writes, hands off, reloads or judges
  // dirtiness reads through this, never tabsRef directly. Patches the ref
  // in place because the onChange the flush triggers only lands in `tabs`
  // on the next render.
  const liveTabs = useCallback((): DocTab[] => {
    tabsRef.current = tabsRef.current.map((tab) => {
      const content = flushEditor(tab.id);
      return content === null || content === tab.content
        ? tab
        : { ...tab, content };
    });
    return tabsRef.current;
  }, []);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  // The tree always mirrors the active tab's folder; with no file open there
  // is nothing to show.
  const rootPath = activeTab.path ? dirname(activeTab.path) : null;
  // Deferred: a whole-document count on every edit would otherwise sit in
  // the same render as the edit itself; the status bar can lag a beat.
  const deferredContent = useDeferredValue(activeTab.content);
  const wordCount = useMemo(
    () => countWords(deferredContent),
    [deferredContent],
  );
  // A markdown-string-length proxy for the same threshold the editor
  // plugins check against the live ProseMirror doc size (see
  // editor/large-doc.ts) - close enough for a status indicator.
  const isLargeDoc = activeTab.content.length > LARGE_DOC_THRESHOLD;
  const activeDirty = tabIsDirty(activeTab);
  const activeTitle = tabTitle(activeTab, t);

  // The OS title names the document too: it is what the taskbar, Alt+Tab
  // and window lists show, where every window read "Levis" before.
  useEffect(() => {
    void getCurrentWindow()
      .setTitle(`${activeTitle} - Levis`)
      .catch(() => {});
  }, [activeTitle]);

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
      const reloadKey =
        (tabsRef.current.find((tb) => tb.id === tabId)?.reloadKey ?? 0) + 1;
      updateTab(tabId, {
        path,
        content: text,
        savedContent: text,
        diskMtime,
        reloadKey,
      });
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

  // The Agent panel's project bar opens the style profile and library
  // entries beside the document being written - always a new tab, never
  // replacing that document (window mode would otherwise swap it out).
  useWindowEvent(OPEN_FILE_IN_TAB_EVENT, (e) => {
    const path = (e as CustomEvent<string>).detail;
    if (typeof path === "string" && path) void openPathInTab(path);
  });

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
      const tab = liveTabs().find((tb) => tb.id === tabId);
      if (!tab) return false;
      const defaultName = tab.path
        ? basename(tab.path)
        : defaultMarkdownFilename(
            tab.content,
            tab.helpDoc ? tabTitle(tab, t) : t.untitledTab,
            settings.autoSuggestFilename,
          );
      const picked = await fs.saveFileDialog(defaultName);
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
        // Image migration rewrote the markdown: the editor has to load it.
        ...(content !== tab.content ? { reloadKey: tab.reloadKey + 1 } : {}),
      });
      return true;
    },
    [updateTab, liveTabs, t, settings.autoSuggestFilename],
  );

  const saveTab = useCallback(
    async (tabId: string): Promise<boolean> => {
      const tab = liveTabs().find((tb) => tb.id === tabId);
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
    [updateTab, liveTabs, saveTabAs, t],
  );

  const toggleSourceMode = useCallback(() => {
    // Live content: entering source mode unmounts the editor, and with it
    // any edit its debounce still holds.
    const tab = liveTabs().find((tb) => tb.id === activeTabId);
    if (!tab) return;
    // Keep the user's place across the switch (editor/mode-switch.ts): the
    // view being left records its caret, the one being entered places it.
    if (tab.sourceMode) {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-active-tab="true"] textarea.source-view',
      );
      setPendingCaret(textarea ? readTextareaCaret(textarea) : null);
      // Leaving source mode: force the WYSIWYG editor to remount so it
      // picks up whatever was typed as raw text.
      updateTab(activeTabId, {
        sourceMode: false,
        splitView: false,
        reloadKey: tab.reloadKey + 1,
      });
    } else {
      setPendingCaret(captureEditorCaret(tab.content));
      updateTab(activeTabId, { content: tab.content, sourceMode: true });
    }
  }, [activeTabId, updateTab, liveTabs]);

  // Split view = source mode with a live preview beside it. From the rich
  // editor it enters source mode the same way (caret carried across); from
  // split view it returns to the rich editor; from plain source mode it
  // just adds the preview.
  const toggleSplitView = useCallback(() => {
    const tab = liveTabs().find((tb) => tb.id === activeTabId);
    if (!tab) return;
    if (tab.sourceMode && tab.splitView) {
      toggleSourceMode();
    } else if (tab.sourceMode) {
      updateTab(activeTabId, { splitView: true });
    } else {
      setPendingCaret(captureEditorCaret(tab.content));
      updateTab(activeTabId, {
        content: tab.content,
        sourceMode: true,
        splitView: true,
      });
    }
  }, [activeTabId, updateTab, liveTabs, toggleSourceMode]);

  // Zen mode: only the text. Sidebar, tab bar, AI panel and window-bar
  // readouts go away, the window goes fullscreen, and every paragraph but
  // the one being written dims (editor/zen-focus-plugin.ts). Esc leaves.
  const [zenMode, setZenMode] = useState(false);
  const toggleZenMode = useCallback(() => setZenMode((on) => !on), []);
  useEffect(() => {
    document.documentElement.classList.toggle("zen", zenMode);
    window.dispatchEvent(new CustomEvent(ZEN_MODE_EVENT, { detail: zenMode }));
    if (!zenMode) return;
    const win = getCurrentWindow();
    // Leaving zen may come before isFullscreen() answers: then fullscreen
    // is never entered, rather than entered after the restore already ran.
    let left = false;
    let restore = false;
    void win.isFullscreen().then((already) => {
      if (already || left) return;
      restore = true;
      void win.setFullscreen(true);
    });
    return () => {
      left = true;
      if (restore) void win.setFullscreen(false);
    };
  }, [zenMode]);
  useEffect(() => {
    if (!zenMode) return;
    // Capture phase: the editor binds Escape itself (and marks the event
    // handled), so a bubbling listener never heard it. Anything on screen
    // that Escape should close first - a dialog, menu, Quick Ask, the find
    // bar - keeps it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.isComposing || e.keyCode === 229) return;
      if (
        document.querySelector(
          '[role="dialog"], [role="menu"], .inline-chat, .find-replace-bar, .context-menu',
        )
      )
        return;
      setZenMode(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [zenMode]);

  // The source view just mounted: put the caret the editor left there.
  const activeSourceMode =
    tabs.find((tb) => tb.id === activeTabId)?.sourceMode ?? false;
  useEffect(() => {
    if (!activeSourceMode) return;
    const caret = takePendingCaret();
    if (!caret) return;
    requestAnimationFrame(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-active-tab="true"] textarea.source-view',
      );
      if (textarea) applyTextareaCaret(textarea, caret);
    });
  }, [activeSourceMode, activeTabId]);

  // Removes a tab outright (no prompt - callers that need one show it
  // first). Closing the last tab closes the window; closing the active tab
  // hands focus to its right-hand neighbor, or the new last tab.
  const removeTab = useCallback(
    (id: string) => {
      const closedIndex = tabsRef.current.findIndex((tb) => tb.id === id);
      setTabs((prev) => {
        const next = prev.filter((tb) => tb.id !== id);
        if (next.length === 0) {
          // Closing the last tab destroys the window, so useDraftAutosave's
          // cleanup effect (which clears a departed tab's snapshot) never gets
          // another run - without the explicit clear here, a dirty tab closed
          // via "Don't Save" comes back as a recovered draft on next launch.
          cancelDraftFlushes();
          void drafts
            .clearDraftSnapshot(id)
            .finally(() => void getCurrentWindow().destroy());
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
    },
    [cancelDraftFlushes],
  );

  const requestCloseTab = useCallback(
    (id: string) => {
      const tab = liveTabs().find((tb) => tb.id === id);
      if (!tab || !tabIsDirty(tab)) {
        removeTab(id);
        return;
      }
      setPendingClose({ kind: "tab", tabId: id });
    },
    [removeTab, liveTabs],
  );

  // Tabs moving BETWEEN windows, in both directions (drag out, drop in,
  // hover preview) - see useTabDragMerge.ts.
  const { dragHoverPreview, handleTabDetach } = useTabDragMerge({
    tabsRef,
    liveTabs,
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

  useGlobalShortcuts({
    activeTabId,
    saveTab,
    requestCloseTab,
    toggleSourceMode,
    toggleSidebar,
    toggleAgentPanel,
    toggleSplitView,
    toggleZenMode,
  });

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
  // a push instead (see lib.rs's queue_paths_to_open). Strictly this window:
  // Rust addresses exactly one window, and a catch-all listener would open
  // the file in every open window (see listenToThisWindow).
  useEffect(() => {
    const unlisten = listenToThisWindow<string[]>(
      "open-paths-as-tabs",
      async (event) => {
        for (const p of event.payload) await openPathInTab(p);
      },
    );
    return unlistenAll(unlisten);
  }, [openPathInTab]);

  // Closing with unsaved changes swaps the native close for the
  // save/discard/cancel prompt, scoped to the whole window (every dirty tab
  // needs a decision, not just the active one). Registered once; reads
  // dirtiness through liveTabs so the listener doesn't churn on every
  // keystroke, and so an edit typed just before closing still counts.
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested((event) => {
      if (!liveTabs().some(tabIsDirty)) return;
      event.preventDefault();
      setPendingClose({ kind: "window" });
    });
    return unlistenAll(unlisten);
  }, [liveTabs]);

  useExternalChangeReload(liveTabs, updateTab);

  // Menu events from Rust (menu.rs's dispatch) - every File/View/Format/Help
  // action the frontend owns arrives here as a window event; see
  // menu-bridge.ts for the actual subscriptions.
  useMenuBridge({
    activeTabId,
    liveTabs,
    t,
    onOpenSettings: () => setSettingsOpen(true),
    onToggleTypewriter: () =>
      setSettings({ typewriterMode: !settings.typewriterMode }),
    onToggleSidebar: toggleSidebar,
    onToggleAgentPanel: toggleAgentPanel,
    onToggleSplitView: toggleSplitView,
    onToggleZenMode: toggleZenMode,
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
    // Scheduled flushes first: a debounce timer firing between the clears
    // below and destroy() would re-save a snapshot that was just deleted.
    cancelDraftFlushes();
    await Promise.all(
      tabsRef.current.map((tab) => drafts.clearDraftSnapshot(tab.id)),
    );
  }, [cancelDraftFlushes]);

  const closeSaving = useCallback(async () => {
    const action = pendingClose;
    setPendingClose(null);
    if (!action) return;
    if (action.kind === "window") {
      // Whole window: save every dirty tab, aborting (leaving the window
      // open) if any of them hits a cancelled Save As.
      for (const tab of liveTabs()) {
        if (!tabIsDirty(tab)) continue;
        const ok = await saveTab(tab.id);
        if (!ok) {
          await session.cancelQuit();
          return;
        }
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
  }, [
    pendingClose,
    saveTab,
    removeTab,
    replaceTabWithFile,
    clearWindowDrafts,
    liveTabs,
  ]);

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

  // The tour's sidebar lesson: open the panel it's about, and tick off each
  // tab as it's shown (the one already showing counts - it's on screen).
  const sidebarLesson =
    tutorial.active &&
    settings.languageChosen &&
    tutorial.step.id === "sidebar";
  const setTutorialPhase = tutorial.setPhase;
  useEffect(() => {
    if (!sidebarLesson) return;
    setPanelOpen(true);
    setTutorialPhase((phase) => phase | SIDEBAR_TAB[panelMode]);
  }, [sidebarLesson, panelMode, setTutorialPhase]);

  const cancelClose = () => {
    setPendingClose(null);
    void session.cancelQuit();
  };
  // A real modal like the app's other dialogs: Escape cancels, and Tab
  // can't wander into the editor behind it and start typing there.
  const closePrompt = useModalDialog(
    cancelClose,
    pendingClose !== null,
    ".close-prompt-primary",
  );

  return (
    <AgentPanelProvider
      open={agentPanel.open}
      setOpen={agentPanel.setOpen}
      container={agentPanelEl}
    >
      <div className="app-shell">
        {/* The window's one top strip: traffic-light room, which document this
          is, and its status. A real row in the layout, not an overlay - the
          overlay title bar hides the native drag area behind the webview, so
          the app has to draw this itself, and drawing it as a transparent
          fixed strip meant the document scrolled underneath and the filename
          sat on top of the text. It is also the drag region (both for moving
          the window and for the drag-to-merge gesture in useTabDragMerge).

          Where the OS supplies no frame at all (Windows), this same row is
          ALSO the caption and the way into the app menu - the two components
          below render nothing anywhere else, so this stays one strip on
          every platform. See ui/window-chrome.ts. */}
        <header className="window-bar" data-tauri-drag-region>
          <AppMenuButton />
          <span className="window-bar-title">{activeTitle}</span>
          <div className="window-bar-status">
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
            {(settings.enableAskAi || tutorial.active) && (
              <button
                type="button"
                className={`window-bar-toggle${agentPanel.open ? " window-bar-toggle-on" : ""}`}
                aria-pressed={agentPanel.open}
                aria-label={t.agentPanelToggle}
                title={`${t.agentPanelToggle} (${formatCombo(settings.shortcuts.toggleAgentPanel)})`}
                onClick={toggleAgentPanel}
              >
                <ChatTabIcon />
              </button>
            )}
          </div>
          <WindowCaptionButtons />
        </header>
        <aside
          className={`sidebar ${panelOpen ? "" : "sidebar-collapsed"} ${sidebarLesson ? "tutorial-spotlight" : ""}`}
        >
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
                {panelMode === "tree" &&
                  (rootPath ? (
                    <FileTree
                      key={rootPath}
                      rootPath={rootPath}
                      activePath={activeTab.path}
                      onFileSelect={openFile}
                    />
                  ) : (
                    // An unsaved draft has no folder - an empty panel read
                    // as broken.
                    <div className="clipboard-empty">{t.treeEmptyDraft}</div>
                  ))}
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
              // Tear-off needs global cursor and window positions - macOS
              // only (tab_drag.rs); on Linux, and above all under Wayland,
              // the drag could only fail and cancel the reorder with it.
              onDetach={isMacPlatform() ? handleTabDetach : undefined}
              onReorder={reorderTab}
              previewTab={dragHoverPreview}
            />
          )}

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
              {tab.sourceMode && tab.splitView ? (
                <SplitView
                  content={tab.content}
                  filePath={tab.path}
                  typewriter={settings.typewriterMode}
                  onChange={(markdown) => handleChange(tab.id, markdown)}
                />
              ) : tab.sourceMode ? (
                <SourceTextarea
                  value={tab.content}
                  typewriter={settings.typewriterMode}
                  onChange={(markdown) => handleChange(tab.id, markdown)}
                />
              ) : (
                <EditorPane
                  key={`${tab.id}-${tab.reloadKey}`}
                  tabId={tab.id}
                  filePath={tab.path}
                  docTitle={tabTitle(tab, t)}
                  initialValue={tab.content}
                  onChange={handleChange}
                  isActive={tab.id === activeTabId}
                  tutorialMock={tutorial.active && tab.id === tutorial.tabId}
                />
              )}
            </div>
          ))}
        </div>

        {agentPanel.open && (
          <aside className="agent-panel" style={{ width: agentPanel.width }}>
            <AgentPanelResizer
              width={agentPanel.width}
              onResize={agentPanel.setWidth}
              label={t.agentPanelResize}
            />
            <div className="agent-panel-mount" ref={setAgentPanelEl} />
            {/* The conversation lives in the rich editor (each tab's
              MilkdownEditor renders it here); source mode and split view
              have none to render, so say so instead of an empty column. */}
            {activeTab.sourceMode && (
              <div className="agent-panel-placeholder">
                <p>{t.agentPanelSourceMode}</p>
                <button
                  type="button"
                  className="text-button"
                  onClick={toggleSourceMode}
                >
                  {t.agentPanelBackToEditor}
                </button>
              </div>
            )}
          </aside>
        )}

        {settingsOpen && (
          <SettingsPanel
            onClose={() => setSettingsOpen(false)}
            onOpenFile={(path) => void openFile(path)}
          />
        )}

        {pendingClose && (
          <div className="close-prompt-overlay">
            <div
              className="close-prompt"
              {...closePrompt}
              role="dialog"
              aria-modal="true"
              aria-label={t.closePromptMessage}
            >
              <p>{t.closePromptMessage}</p>
              <div className="close-prompt-buttons">
                <button
                  className="close-prompt-discard"
                  onClick={() => void closeDiscarding()}
                >
                  {t.closePromptDiscard}
                </button>
                <div className="close-prompt-spacer" />
                <button onClick={cancelClose}>{t.closePromptCancel}</button>
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

        {zenMode && (
          <div className="zen-hint" role="status">
            {t.zenExitHint}
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
                {appUpdate.selfUpdate ? (
                  <button
                    className="update-toast-primary"
                    onClick={() => void appUpdate.install()}
                  >
                    {t.updateInstall}
                  </button>
                ) : (
                  <span>{t.updateViaPackageManager}</span>
                )}
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

        {tutorial.active && settings.languageChosen && (
          <TutorialExperience
            tutorial={tutorial}
            t={t}
            shortcuts={{
              completion: formatCombo(settings.shortcuts.triggerCompletion),
              grammar: formatCombo(settings.shortcuts.triggerGrammarCheck),
              agent: formatCombo(settings.shortcuts.toggleFloatingChat),
              sidebar: formatCombo(settings.shortcuts.toggleSidebar),
            }}
          />
        )}
        {!settings.languageChosen && (
          <LanguageWelcome
            language={settings.language}
            onLanguage={(language) => setSettings({ language })}
            onContinue={() => setSettings({ languageChosen: true })}
          />
        )}
      </div>
    </AgentPanelProvider>
  );
}

export default App;
