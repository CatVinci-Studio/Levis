import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppDialogHost, showConfirm, showMessage } from "../ui/app-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileTree } from "../sidebar/FileTree";
import { Outline } from "../sidebar/Outline";
import { ClipboardHistory } from "../sidebar/ClipboardHistory";
import { ChatHistory } from "../sidebar/ChatHistory";
import {
  TreeTabIcon,
  OutlineTabIcon,
  ClipboardTabIcon,
  ChatTabIcon,
} from "../ui/icons";
import { WindowBar } from "./WindowBar";
import { installClipboardCapture } from "../clipboard/history";
import { EditorPane } from "../document-view/EditorPane";
import { flushEditor } from "../editor/editor-flush";
import {
  canDragTabsBetweenWindows,
  canToggleFullscreen,
  canUseWindows,
  isIOSApp,
} from "../platform/capabilities";
import { iosFiles, useIOSDocumentsFolder } from "../platform/ios-files";
import {
  forgetIOSDocument,
  rememberIOSDocument,
} from "../document/ios-recents";
import { SettingsPanel } from "../settings/SettingsPanel";
import { DocumentList } from "../mobile/DocumentList";
import { KeyboardToolbar } from "../mobile/KeyboardToolbar";
import { ActionSheet } from "../ui/ActionSheet";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import { keyboardUp, whenKeyboardDown } from "../mobile/keyboard";
import { useSettings } from "../settings/SettingsContext";
import { useTutorial } from "../onboarding/useTutorial";
import { TutorialExperience } from "../onboarding/TutorialExperience";
import { SIDEBAR_TAB } from "../onboarding/tutorial-evaluation";
import { LanguageWelcome } from "../onboarding/LanguageWelcome";
import { useLevisImportOffer } from "../settings/levis-import";
import { useTutorialDocumentEvaluation } from "../onboarding/useTutorialDocumentEvaluation";
import { TabBar } from "./TabBar";
import { countWords } from "../utils/word-count";
import { LARGE_DOC_THRESHOLD } from "../editor/large-doc";
import { migrateDraftImages } from "../editor/images/image-migration";
import { formatCombo } from "../utils/shortcuts";
import { useAppUpdate } from "./useAppUpdate";
import { useZoom } from "./useZoom";
import {
  applyTextareaCaret,
  captureEditorCaret,
  readTextareaCaret,
  setPendingCaret,
  takePendingCaret,
} from "../editor/modes/mode-switch";
import { listenToThisWindow, unlistenAll } from "../utils/tauri-events";
import { basename, dirname } from "../utils/path";
import {
  helpDocContent,
  makeBlankTab,
  readDocFromDisk,
  statMtime,
  tabIsDirty,
  tabTitle,
  type DocTab,
  type HelpDoc,
} from "../document/doc-tabs";
import { useTabDragMerge } from "./useTabDragMerge";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { useExternalChangeReload } from "../document/useExternalChangeReload";
import { useDraftAutosave } from "../document/draft-autosave";
import { useMenuBridge, useNativeMenuChecks } from "./menu-bridge";
import { useStartupRestore } from "../document/startup-restore";
import { drafts, fs, session, storage } from "../platform/ipc";
import { flushPendingWrites } from "../storage/pending-writes";
import { defaultMarkdownFilename } from "../document/save-default-name";
import { useModalDialog } from "../ui/useModalDialog";
import { Presence, PresenceDiv, usePresence } from "../ui/usePresence";
import { FlipOnChange } from "../ui/flip";
import { SplitView } from "../editor/modes/SplitView";
import { SourceTextarea } from "../editor/modes/SourceTextarea";
import { useWindowEvent } from "../utils/hooks/useWindowEvent";
import { OPEN_FILE_IN_TAB_EVENT, ZEN_MODE_EVENT } from "../utils/events";
import {
  AgentPanelProvider,
  AgentPanelResizer,
  AgentPanelSheetGrip,
  useAgentPanelState,
} from "../ai/chat/panel/agent-panel";
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

/** The sidebar's width (sidebar-frame.css .sidebar) and the narrowest text column
 *  the docked panel may leave beside it. */
const SIDEBAR_WIDTH = 240;
const MIN_TEXT_COLUMN = 420;

function subscribeWindowResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function App() {
  const { t, settings, setSettings } = useSettings();
  // A Levis installation on this computer is offered once, before the
  // language welcome (its import brings the language already chosen).
  const markLevisOffered = useCallback(
    () => setSettings({ levisImportOffered: true }),
    [setSettings],
  );
  const levisOffer = useLevisImportOffer(
    t,
    settings.language,
    settings.levisImportOffered,
    markLevisOffered,
    (items) => {
      // The first-launch guide started before the offer was answered; a
      // Levis user who had already been through it there doesn't get it
      // again (Levis's onboardingShown came over with its settings).
      if (!items.includes("settings")) return;
      void storage.settingsGet().then(({ value }) => {
        if (value.onboardingShown === true) tutorial.exit();
      });
    },
  );
  const [tabs, setTabs] = useState<DocTab[]>(() => [makeBlankTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);
  // The one save/discard/cancel prompt, reused for every "this would lose
  // unsaved content" moment: closing a tab, closing the whole window (every
  // dirty tab needs a decision, not just the active one), or replacing the
  // active tab's document in place (window-mode Open File / agent.md).
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const toggleSidebar = useCallback(() => setPanelOpen((v) => !v), []);
  // The docked Agent panel on the right (ai/chat/panel/agent-panel.tsx). App owns
  // the frame; the active tab's editor renders its conversation into it.
  const agentPanel = useAgentPanelState();
  // With the sidebar and the docked panel both open, a small window left
  // the text column ~120px wide - a word a line. Below this much room for
  // the text the panel lies over the page instead, as it does on a narrow
  // window (agent-panel.css).
  const windowWidth = useSyncExternalStore(subscribeWindowResize, () =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  const agentOverlays =
    !isIOSApp &&
    panelOpen &&
    windowWidth - SIDEBAR_WIDTH - agentPanel.width < MIN_TEXT_COLUMN;
  const [agentPanelEl, setAgentPanelEl] = useState<HTMLElement | null>(null);
  // On a phone, opening the sheet puts the keyboard away in one movement:
  // the document gives up focus here and the sheet's input doesn't take it
  // (ChatComposer's focusOnOpen), where handing focus from one to the other
  // dropped the keyboard and raised it again.
  // And with the keyboard up, the sheet rises once it has gone: laid out
  // in a web view still growing back to full height under it, the sheet's
  // top jumped and its composer arrived late from below.
  const pendingAgentOpen = useRef<(() => void) | null>(null);
  const toggleAgentPanel = useCallback(() => {
    if (pendingAgentOpen.current) {
      // A second tap while it waits: it stays closed.
      pendingAgentOpen.current();
      pendingAgentOpen.current = null;
      return;
    }
    if (isIOSApp && !agentPanel.open) {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
      if (keyboardUp()) {
        pendingAgentOpen.current = whenKeyboardDown(() => {
          pendingAgentOpen.current = null;
          agentPanel.setOpen(true);
        });
        return;
      }
    }
    agentPanel.toggle();
  }, [agentPanel]);
  // Both side panels play their way out before their contents go: the
  // sidebar slides back over the editor, the AI panel fades off its edge.
  // The editor makes its room (or takes it back) at once, gliding there
  // (FlipOnChange below) rather than reflowing on every frame.
  const sidebarPresence = usePresence(panelOpen, { exitMs: 250 });
  const sidebarClosing = sidebarPresence.state === "closing";
  const agentPresence = usePresence(agentPanel.open, { exitMs: 250 });
  const agentClosing = agentPresence.state === "closing";
  // The phone's AI sheet leaves where it stood: closing with the keyboard
  // up, the web view grew back under it as the keyboard went and its
  // height (a share of the view) jumped the top up ~170pt in one frame.
  useLayoutEffect(() => {
    const sheet = document.querySelector<HTMLElement>("aside.agent-panel");
    if (!isIOSApp || !sheet) return;
    if (!agentClosing) {
      for (const prop of ["top", "bottom", "height"])
        sheet.style.removeProperty(prop);
      return;
    }
    if (getComputedStyle(sheet).position !== "fixed") return;
    const box = sheet.getBoundingClientRect();
    sheet.style.top = `${box.top}px`;
    sheet.style.bottom = "auto";
    sheet.style.height = `${box.height}px`;
  }, [agentClosing]);
  // iPhone: whether the AI bottom sheet is pulled up to full height.
  const [sheetFull, setSheetFull] = useState(false);
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
  // The tree always mirrors the active tab's folder. With no file open there
  // is nothing to show - except on iOS, where the app's Documents folder is
  // home: where Save puts new documents, and what Files lists under Textus.
  const iosDocuments = useIOSDocumentsFolder();
  useEffect(() => {
    void rememberIOSDocument(activeTab.path);
  }, [activeTab.path]);
  const rootPath = activeTab.path ? dirname(activeTab.path) : iosDocuments;
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
  // and window lists show, where every window read "Textus" before.
  useEffect(() => {
    if (!canUseWindows) return;
    void getCurrentWindow()
      .setTitle(`${activeTitle} - Textus`)
      .catch(() => {});
  }, [activeTitle]);

  // Reports this window's on-disk tab paths to Rust so a relaunch (an app
  // update, a crash, or just quitting and reopening) can restore what was
  // open - see commands/session.rs. Untitled/unsaved tabs have no path and
  // are simply skipped; keyed on the joined path list (not `tabs` itself) so
  // content edits don't spam the round trip.
  const sessionPathsKey = tabs.map((tab) => tab.path ?? "").join("\n");
  useEffect(() => {
    if (!canUseWindows) return;
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
  // A guide follows the UI language: switching it swaps the text of every
  // open guide the user hasn't edited (an edited one is theirs to keep).
  useEffect(() => {
    setTabs((prev) => {
      let changed = false;
      const next = prev.map((tab) => {
        if (!tab.helpDoc || tab.content !== tab.savedContent) return tab;
        const content = helpDocContent(tab.helpDoc, settings.language);
        if (content === tab.content) return tab;
        changed = true;
        return {
          ...tab,
          content,
          savedContent: content,
          reloadKey: tab.reloadKey + 1,
        };
      });
      return changed ? next : prev;
    });
  }, [settings.language]);
  const openingHelp = useRef(new Set<HelpDoc>());
  const openHelpTab = useCallback(
    (doc: HelpDoc) => {
      // Help documents are destinations of their own, never a continuation
      // of an in-progress onboarding run. Without this, a persisted tutorial
      // could remain floating over the Markdown/AI guide after it opens.
      stopTutorial();
      // Checked against the tab list as it is being updated, not the last
      // render's: one menu click can reach several listeners in the same
      // instant (a re-subscribed listener whose predecessor hasn't been
      // released yet), and each used to see "no guide open" and add one.
      const content = helpDocContent(doc, settings.language);
      const fresh = {
        ...makeBlankTab(),
        content,
        savedContent: content,
        helpDoc: doc,
      };
      // A second call before React has applied the first one only needs to
      // land on the same tab.
      if (openingHelp.current.has(doc)) return;
      openingHelp.current.add(doc);
      requestAnimationFrame(() => openingHelp.current.delete(doc));
      let target = fresh.id;
      setTabs((prev) => {
        const existing = prev.find((tab) => tab.helpDoc === doc);
        if (existing) {
          target = existing.id;
          return prev;
        }
        return [...prev, fresh];
      });
      setActiveTabId(() => target);
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
          void showMessage(
            `${t.imageMigrationFailedMessage}\n${migration.failed.join("\n")}`,
            {
              title: t.imageMigrationFailedTitle,
              tone: "warning",
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
          const overwrite = await showConfirm(t.fileChangedOnDiskMessage, {
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

  // Back to the rich editor, from plain source mode or split view alike.
  const leaveSourceMode = useCallback(
    (tab: DocTab) => {
      // Keep the user's place across the switch (editor/modes/mode-switch.ts): the
      // view being left records its caret, the one being entered places it.
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-active-tab="true"] textarea.source-view',
      );
      setPendingCaret(textarea ? readTextareaCaret(textarea) : null);
      // Force the WYSIWYG editor to remount so it picks up whatever was
      // typed as raw text.
      updateTab(tab.id, {
        sourceMode: false,
        splitView: false,
        reloadKey: tab.reloadKey + 1,
      });
    },
    [updateTab],
  );

  const toggleSourceMode = useCallback(() => {
    // Live content: entering source mode unmounts the editor, and with it
    // any edit its debounce still holds.
    const tab = liveTabs().find((tb) => tb.id === activeTabId);
    if (!tab) return;
    if (tab.sourceMode && tab.splitView) {
      // Split view shows Source Mode as off - the menu check and the switch
      // in Settings both say so - so turning it on from there means plain
      // source mode: the preview goes, the source stays.
      updateTab(activeTabId, { splitView: false });
    } else if (tab.sourceMode) {
      leaveSourceMode(tab);
    } else {
      setPendingCaret(captureEditorCaret(tab.content));
      updateTab(activeTabId, { content: tab.content, sourceMode: true });
    }
  }, [activeTabId, updateTab, liveTabs, leaveSourceMode]);

  // Split view = source mode with a live preview beside it. From the rich
  // editor it enters source mode the same way (caret carried across); from
  // split view it returns to the rich editor; from plain source mode it
  // just adds the preview.
  const toggleSplitView = useCallback(() => {
    const tab = liveTabs().find((tb) => tb.id === activeTabId);
    if (!tab) return;
    if (tab.sourceMode && tab.splitView) {
      leaveSourceMode(tab);
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
  }, [activeTabId, updateTab, liveTabs, leaveSourceMode]);

  // Zen mode: only the text. Sidebar, tab bar, AI panel and window-bar
  // readouts go away, the window goes fullscreen, and every paragraph but
  // the one being written dims (editor/modes/zen-focus-plugin.ts). Esc leaves.
  const [zenMode, setZenMode] = useState(false);
  const toggleZenMode = useCallback(() => setZenMode((on) => !on), []);
  // In the commit itself, before paint: the text column's glide
  // (FlipOnChange) measures the layout this class makes.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("zen", zenMode);
  }, [zenMode]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(ZEN_MODE_EVENT, { detail: zenMode }));
    if (!zenMode || !canToggleFullscreen) return;
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
          ':is([role="dialog"], [role="menu"], .inline-chat, .find-replace-bar, .context-menu):not([data-state="closing"] *, [data-state="closing"])',
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
          // No window to close on iOS: the last tab simply stays.
          if (!canUseWindows) return prev;
          // Closing the last tab destroys the window, so useDraftAutosave's
          // cleanup effect (which clears a departed tab's snapshot) never gets
          // another run - without the explicit clear here, a dirty tab closed
          // via "Don't Save" comes back as a recovered draft on next launch.
          // Storage writes still on their way go first, like every close.
          cancelDraftFlushes();
          void Promise.allSettled([
            drafts.clearDraftSnapshot(id),
            flushPendingWrites(),
          ]).then(() => void getCurrentWindow().destroy());
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
  // `textus` CLI command) at launch, recovered drafts, a dragged-in tab, or a
  // Help doc this window was spawned to show - see startup-restore.ts for
  // the actual priority chain. Deliberately runs only once, at mount.
  useStartupRestore({
    activeTabId,
    enableDraftRecovery: settings.enableDraftRecovery,
    newDocumentMode: settings.newDocumentMode,
    language: settings.language,
    onboardingShown: settings.onboardingShown,
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
  // Every way of closing a window lands here - its close button, File >
  // Close Window, Quit (Cmd+Q closes each window in turn), Alt+F4 - and the
  // Tauri API destroys the window once this handler resolves, unless it
  // prevented the close. So with nothing to ask, it first waits for the
  // storage writes still on their way to Rust (a setting typed a moment
  // ago) or held back (the resting zoom); the prompt's Save / Don't Save do the same before they
  // destroy the window themselves.
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      if (liveTabs().some(tabIsDirty)) {
        event.preventDefault();
        setPendingClose({ kind: "window" });
        return;
      }
      await flushPendingWrites();
    });
    return unlistenAll(unlisten);
  }, [liveTabs]);

  useExternalChangeReload(liveTabs, updateTab);

  // Menu events from Rust (menu.rs's dispatch) - every File/View/Format/Help
  // action the frontend owns arrives here as a window event; see
  // menu-bridge.ts for the actual subscriptions.
  // iPhone: the document list (menu > Documents). Opening an entry that no
  // longer exists (moved or deleted in Files) drops it from the list.
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const openFromDocuments = useCallback(
    (path: string) => {
      setDocumentsOpen(false);
      void openFile(path).catch(() => forgetIOSDocument(path));
    },
    [openFile],
  );
  // A renamed document stays open under its new name; a deleted one keeps
  // its text in the tab, unsaved, so nothing on screen is lost with it.
  const documentRenamed = useCallback((from: string, to: string) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.path === from ? { ...tab, path: to } : tab)),
    );
  }, []);
  const documentDeleted = useCallback((path: string) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.path === path
          ? { ...tab, path: null, savedContent: "", diskMtime: null }
          : tab,
      ),
    );
  }, []);
  // Settings > Skills > Reset deleted a customized skill's file. A tab
  // still showing it must not write it back on the next save: an unedited
  // one closes (the window's only tab becomes a blank one instead of
  // closing the window), an edited one keeps its text as an unsaved draft.
  const skillFilesDeleted = useCallback(
    (paths: string[]) => {
      for (const tab of tabsRef.current) {
        if (!tab.path || !paths.includes(tab.path)) continue;
        if (tabIsDirty(tab)) {
          documentDeleted(tab.path);
        } else if (tabsRef.current.length > 1) {
          removeTab(tab.id);
        } else {
          const blank = makeBlankTab();
          setTabs([blank]);
          setActiveTabId(blank.id);
        }
      }
    },
    [documentDeleted, removeTab],
  );

  // iPhone menu > Share: the share sheet needs a file, so an unsaved or
  // never-saved document is saved first (into Documents, if it is new).
  const shareActiveTab = useCallback(async () => {
    const tab = liveTabs().find((tb) => tb.id === activeTabId);
    if (!tab) return;
    if ((!tab.path || tabIsDirty(tab)) && !(await saveTab(tab.id))) return;
    // A first save lands in `tabs` on the next render.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const path = tabsRef.current.find((tb) => tb.id === tab.id)?.path;
    if (path) await iosFiles.share(path).catch(() => {});
  }, [activeTabId, liveTabs, saveTab]);

  // Which View items are on: the check marks in the app-drawn menu and in
  // the macOS menu bar.
  const menuChecks = {
    sidebar: panelOpen,
    agentPanel: agentPanel.open,
    sourceMode: !!activeTab.sourceMode && !activeTab.splitView,
    splitView: !!activeTab.sourceMode && !!activeTab.splitView,
    typewriter: settings.typewriterMode,
    zen: zenMode,
  };
  useNativeMenuChecks(menuChecks);

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
    onOpenDocuments: () => setDocumentsOpen(true),
    shareActiveTab,
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
      await flushPendingWrites();
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
      await flushPendingWrites();
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
  const phone = usePhoneLayout();

  return (
    <AgentPanelProvider
      // The conversation stays in the panel while it plays its exit.
      open={agentPresence.mounted}
      setOpen={agentPanel.setOpen}
      container={agentPanelEl}
    >
      <FlipOnChange
        watch={`${panelOpen} ${agentPresence.mounted} ${zenMode}`}
        targets={() =>
          document.querySelectorAll(
            '[data-active-tab="true"] > .editor-scroll > .editor-content, [data-active-tab="true"] > .source-view, .tab-bar > [data-flip-id]',
          )
        }
        duration="--dur-slow"
        easing="--ease-spring"
      />
      <div
        className="app-shell"
        style={
          {
            "--docked-panel-width":
              agentPresence.mounted && !agentOverlays && !isIOSApp
                ? `${agentPanel.width}px`
                : "0px",
          } as React.CSSProperties
        }
      >
        <WindowBar
          menuChecks={menuChecks}
          title={activeTitle}
          dirty={activeDirty}
          largeDoc={isLargeDoc}
          words={wordCount.words}
          showAgentToggle={settings.enableAskAi || tutorial.active}
          agentOpen={agentPanel.open}
          agentShortcut={formatCombo(settings.shortcuts.toggleAgentPanel)}
          onToggleAgent={toggleAgentPanel}
        />
        {/* iPhone: the sidebar is a drawer over the page (mobile/styles),
          and a tap beside it closes it. */}
        <Presence show={isIOSApp && panelOpen} exitMs={250}>
          {isIOSApp && panelOpen && (
            <PresenceDiv className="sidebar-scrim" onClick={toggleSidebar} />
          )}
        </Presence>
        <aside
          ref={sidebarPresence.ref}
          className={`sidebar ${panelOpen ? "" : "sidebar-collapsed"} ${sidebarLesson ? "tutorial-spotlight" : ""}`}
        >
          {/* Contents only render while open (and inert while the sidebar
            slides away) - a collapsed sidebar is just moved out of view,
            not unmounted, so without this its buttons/tree would stay in
            the tab order and Tab could land focus on them from the
            editor. */}
          {sidebarPresence.mounted && (
            <>
              <div
                className="sidebar-header"
                inert={sidebarClosing || undefined}
              >
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
              <div className="sidebar-body" inert={sidebarClosing || undefined}>
                {panelMode === "tree" &&
                  (rootPath ? (
                    <FileTree
                      key={rootPath}
                      rootPath={rootPath}
                      activePath={activeTab.path}
                      onFileSelect={(path) => {
                        // On a phone the drawer covers the page it just
                        // opened (mobile/styles); a docked one stays.
                        if (
                          isIOSApp &&
                          window.matchMedia("(max-width: 760px)").matches
                        )
                          setPanelOpen(false);
                        void openFile(path);
                      }}
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
              onDetach={canDragTabsBetweenWindows ? handleTabDetach : undefined}
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

        {agentPresence.mounted && (
          <aside
            ref={agentPresence.ref}
            data-state={agentPresence.state}
            inert={agentClosing || undefined}
            className={`agent-panel${sheetFull ? " agent-panel-sheet-full" : ""}${agentOverlays ? " agent-panel-overlay" : ""}`}
            style={{ width: agentPanel.width }}
          >
            {/* Phone widths: the panel is a bottom sheet (mobile/styles)
              and this is its handle; hidden elsewhere. */}
            {isIOSApp && (
              <AgentPanelSheetGrip
                full={sheetFull}
                onFullChange={setSheetFull}
                onClose={() => agentPanel.setOpen(false)}
                label={t.agentPanelSheet}
              />
            )}
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

        {/* The longest exit is the phone's: the page going back down. */}
        <Presence show={settingsOpen} exitMs={320}>
          {settingsOpen && (
            <SettingsPanel
              onClose={() => setSettingsOpen(false)}
              onOpenFile={(path) => void openFile(path)}
              onFilesDeleted={skillFilesDeleted}
              viewChecks={{
                sourceMode: !!activeTab.sourceMode && !activeTab.splitView,
                zen: zenMode,
              }}
            />
          )}
        </Presence>

        <Presence show={!!pendingClose && phone} exitMs={250}>
          {pendingClose && phone && (
            // The iPhone asks what to do with an edited document from the
            // bottom of the screen, as Notes and Pages do. The sheet runs its
            // onClose before the chosen action: cancelClose's quit-cancel is
            // a desktop-only call (a no-op here), and the two handlers still
            // hold the pending close they were rendered with.
            <ActionSheet
              title={t.closePromptMessage}
              items={[
                {
                  label: t.closePromptSave,
                  onSelect: () => void closeSaving(),
                },
                {
                  label: t.closePromptDiscard,
                  danger: true,
                  onSelect: () => void closeDiscarding(),
                },
              ]}
              onClose={cancelClose}
            />
          )}
        </Presence>
        <Presence show={!!pendingClose && !phone} exitMs={120}>
          {pendingClose && !phone && (
            <PresenceDiv className="close-prompt-overlay">
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
            </PresenceDiv>
          )}
        </Presence>

        {isIOSApp && <KeyboardToolbar />}
        <Presence show={isIOSApp && documentsOpen} exitMs={320}>
          {isIOSApp && documentsOpen && (
            <DocumentList
              activePath={activeTab.path}
              onClose={() => setDocumentsOpen(false)}
              onOpen={openFromDocuments}
              onRenamed={documentRenamed}
              onDeleted={documentDeleted}
              onOpenOther={() => {
                setDocumentsOpen(false);
                void openFileDialog();
              }}
            />
          )}
        </Presence>
        <AppDialogHost okLabel={t.dialogOk} />

        {zenMode &&
          (isIOSApp ? (
            // No Esc key on a phone, and zen hides the menu: the hint is
            // the way out, so it stays (faintly) and takes a tap.
            <button
              type="button"
              className="zen-hint zen-hint-button"
              onClick={() => setZenMode(false)}
            >
              {t.zenExitButton}
            </button>
          ) : (
            <div className="zen-hint" role="status">
              {t.zenExitHint}
            </div>
          ))}

        <Presence show={draftsRestoredCount > 0} exitMs={120}>
          {draftsRestoredCount > 0 && (
            <PresenceDiv className="draft-restored-toast">
              <span>{t.draftRestoredMessage}</span>
              <button
                className="update-toast-secondary"
                onClick={() => setDraftsRestoredCount(0)}
              >
                {t.draftRestoredDismiss}
              </button>
            </PresenceDiv>
          )}
        </Presence>

        <Presence show={appUpdate.status !== "idle"} exitMs={120}>
          {appUpdate.status !== "idle" && (
            <PresenceDiv className="update-toast">
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
            </PresenceDiv>
          )}
        </Presence>

        {tutorial.active && settings.languageChosen && !levisOffer.pending && (
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
        <Presence
          show={!settings.languageChosen && !levisOffer.pending}
          exitMs={200}
        >
          {!settings.languageChosen && !levisOffer.pending && (
            <LanguageWelcome
              language={settings.language}
              onLanguage={(language) => setSettings({ language })}
              onContinue={() => setSettings({ languageChosen: true })}
            />
          )}
        </Presence>
      </div>
    </AgentPanelProvider>
  );
}

export default App;
