import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileTree } from "./sidebar/FileTree";
import { Outline } from "./sidebar/Outline";
import { ClipboardHistory } from "./sidebar/ClipboardHistory";
import { ChatHistory } from "./sidebar/ChatHistory";
import { TreeTabIcon, OutlineTabIcon, ClipboardTabIcon, ChatTabIcon } from "./sidebar/icons";
import { installClipboardCapture } from "./utils/clipboard-history";
import { EditorPane } from "./editor/EditorPane";
import { SettingsPanel } from "./settings/SettingsPanel";
import { useSettings } from "./settings/SettingsContext";
import { TabBar } from "./TabBar";
import { countWords } from "./utils/word-count";
import { comboFromEvent } from "./utils/shortcuts";
import { useAppUpdate } from "./utils/useAppUpdate";
import { useZoom } from "./utils/useZoom";
import {
  TRIGGER_COMPLETION_EVENT,
  TRIGGER_GRAMMAR_CHECK_EVENT,
  TOGGLE_FLOATING_CHAT_EVENT,
  TOGGLE_FIND_REPLACE_EVENT,
  INSERT_BLOCK_EVENT,
} from "./utils/events";
import type { Strings } from "./i18n/strings";
import markdownGuideEn from "./help/markdown-guide.en.md?raw";
import markdownGuideZh from "./help/markdown-guide.zh.md?raw";
import markdownGuideJa from "./help/markdown-guide.ja.md?raw";
import agentGuideEn from "./help/agent-guide.en.md?raw";
import agentGuideZh from "./help/agent-guide.zh.md?raw";
import agentGuideJa from "./help/agent-guide.ja.md?raw";
import "./App.css";

type PanelMode = "tree" | "outline" | "clipboard" | "chat";

interface WindowBounds {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

// The drop target is a window's TAB ROW specifically (the tab bar if it has
// one, or just its title strip if it's a single-tab window showing only the
// filename) - not the window's whole body. Matches this app's other top
// strip (.titlebar-drag-region is 28px; the tab bar itself runs a bit
// taller with its own padding) with headroom.
const TAB_ROW_HEIGHT_LOGICAL = 60;

// All drag hit-testing happens in the global LOGICAL coordinate space -
// PointerEvent.screenX/Y and the Rust drag-tick cursor are both logical
// points - so each candidate window's physical bounds are converted via its
// OWN scaleFactor (it may sit on a different-DPI display than the one the
// drag started from).
function pointInTopStrip(lx: number, ly: number, w: WindowBounds): boolean {
  const x = w.x / w.scaleFactor;
  const y = w.y / w.scaleFactor;
  const width = w.width / w.scaleFactor;
  return lx >= x && lx <= x + width && ly >= y && ly <= y + TAB_ROW_HEIGHT_LOGICAL;
}

interface DocTab {
  id: string;
  path: string | null;
  content: string;
  // What's on disk (or "" for a fresh draft) - dirtiness is divergence from
  // this, and it's what the close-confirmation prompt keys off.
  savedContent: string;
  sourceMode: boolean;
  reloadKey: number;
  // A bundled Help menu document: still a pathless draft (edits never touch
  // disk; Save goes through Save As), but titled after itself instead of
  // "Untitled", and deduped per doc so Help focuses the existing tab rather
  // than opening another copy.
  helpDoc?: HelpDoc;
}

// Mirrors the doc ids Rust puts in its Help menu ids (lib.rs
// HELP_DOC_PREFIX) - they arrive here as the menu-open-help payload.
type HelpDoc = "markdown" | "agent";

function helpDocContent(doc: HelpDoc, lang: string): string {
  if (doc === "agent") {
    if (lang === "zh") return agentGuideZh;
    if (lang === "ja") return agentGuideJa;
    return agentGuideEn;
  }
  if (lang === "zh") return markdownGuideZh;
  if (lang === "ja") return markdownGuideJa;
  return markdownGuideEn;
}

// A tab's display name everywhere one is shown (tab pill, title strip,
// detached-drag pill, export default filename).
function tabTitle(tab: DocTab, t: Strings): string {
  if (tab.path) return basename(tab.path);
  if (tab.helpDoc === "markdown") return t.markdownGuideTab;
  if (tab.helpDoc === "agent") return t.agentGuideTab;
  return t.untitledTab;
}

function makeBlankTab(): DocTab {
  return {
    id: crypto.randomUUID(),
    path: null,
    content: "",
    savedContent: "",
    sourceMode: false,
    reloadKey: 0,
  };
}

// Module-scoped, NOT a ref: React StrictMode (dev builds) runs mount
// effects twice on the same component, and the OS-open drain below is a
// destructive pull from a shared Rust-side queue - a second run steals
// paths meant for other windows (symptom: one window gets the wrong file,
// another goes blank). Module state survives the StrictMode remount;
// separate windows are separate webviews with their own module instance,
// so each window still drains exactly once.
let openQueueDrained = false;

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : path;
}

function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// File > Export entries beyond PDF/HTML convert through a user-installed
// pandoc; keys are pandoc writer names, matching the menu ids in lib.rs.
const PANDOC_FORMATS: Record<string, { ext: string; label: string }> = {
  docx: { ext: "docx", label: "Word" },
  odt: { ext: "odt", label: "OpenDocument" },
  rtf: { ext: "rtf", label: "RTF" },
  epub: { ext: "epub", label: "EPUB" },
  latex: { ext: "tex", label: "LaTeX" },
  mediawiki: { ext: "wiki", label: "MediaWiki" },
  rst: { ext: "rst", label: "reStructuredText" },
  textile: { ext: "textile", label: "Textile" },
  opml: { ext: "opml", label: "OPML" },
};

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
  // Set while a floating tab drag is hovering THIS window's tab row as a
  // merge target - rendered as a real-looking pill riding the cursor along
  // the bar (x is already window-local logical px; see the "drag-hover"
  // listener below for the conversion).
  const [dragHoverPreview, setDragHoverPreview] = useState<{ title: string; dirty: boolean; x: number } | null>(null);
  // This window's own left edge in global logical points, cached for the
  // duration of one hover (the window can't move while something is being
  // dragged over it) - converts the drag's global cursor x to local.
  const previewWinLeftRef = useRef<number | null>(null);
  const appUpdate = useAppUpdate();
  useZoom(settings.zoom, (zoom) => setSettings({ zoom }));

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
  const activeDirty = activeTab.content !== activeTab.savedContent;
  const anyDirty = tabs.some((tab) => tab.content !== tab.savedContent);
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

  // Nothing to switch between with a single tab, regardless of
  // newDocumentMode - the setting only decides how NEW documents open, not
  // whether the bar shows. A single-tab window stays draggable-to-merge via
  // its native title bar instead (see the onMoved effect below) - but the
  // bar still needs to appear the moment an incoming-tab preview lands, so the
  // incoming tab has somewhere to show up before the merge actually happens.
  const showTabBar = tabs.length > 1 || dragHoverPreview !== null;

  const updateTab = useCallback((id: string, patch: Partial<DocTab>) => {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  }, []);

  const openPathInTab = useCallback(async (path: string) => {
    const existing = tabsRef.current.find((tab) => tab.path === path);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const text = await invoke<string>("read_text_file", { path });
    void invoke("add_recent_file", { path }); // feeds File > Open Recent
    const newTab = { ...makeBlankTab(), path, content: text, savedContent: text };
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
      const text = await invoke<string>("read_text_file", { path });
      void invoke("add_recent_file", { path });
      updateTab(activeTabId, { path, content: text, savedContent: text });
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
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab) return false;
    const picked = await invoke<string | null>("save_file_dialog");
    if (!picked) return false;
    await invoke("write_text_file", { path: picked, contents: tab.content });
    void invoke("add_recent_file", { path: picked });
    updateTab(tabId, { path: picked, savedContent: tab.content });
    return true;
  }, [updateTab]);

  const saveTab = useCallback(async (tabId: string): Promise<boolean> => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab) return false;
    // Draft never saved before: ask where to put it, then this document
    // graduates into a real file (the sidebar tree picks up its folder).
    if (!tab.path) return saveTabAs(tabId);
    await invoke("write_text_file", { path: tab.path, contents: tab.content });
    updateTab(tabId, { savedContent: tab.content });
    return true;
  }, [updateTab, saveTabAs]);

  // Serializes the active tab's live editor DOM - what you see is what
  // exports - with every stylesheet inlined so the file is self-contained.
  // Relative image paths (assets/...) are kept as-is, like Typora's HTML
  // export next to the document.
  const exportHtml = useCallback(async () => {
    const tab = tabsRef.current.find((t) => t.id === activeTabId);
    if (!tab) return;
    const editor = document.querySelector('[data-active-tab="true"] .milkdown');
    if (!editor) {
      await message(t.exportNeedsWysiwyg, { title: t.exportFailedTitle });
      return;
    }
    const base = tab.path ? basename(tab.path).replace(/\.[^.]+$/, "") : tabTitle(tab, t);
    const picked = await invoke<string | null>("export_save_dialog", {
      defaultName: `${base}.html`,
      filterName: "HTML",
      ext: "html",
    });
    if (!picked) return;
    const clone = editor.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
    let css = "";
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        css += Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join("\n");
        css += "\n";
      } catch {
        // Cross-origin sheet (none in practice) - skip.
      }
    }
    // Same ancestor classes as the app so theme selectors keep applying,
    // plus overrides freeing the page from the app's fixed-viewport layout.
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(base)}</title>
<style>${css}</style>
<style>.app-shell, .main-pane, .editor-scroll { height: auto; overflow: visible; } .editor-content { padding: 2rem 0; }</style>
</head>
<body class="${document.body.className}">
<div class="app-shell"><div class="main-pane"><div class="editor-scroll"><div class="editor-content">${clone.outerHTML}</div></div></div></div>
</body>
</html>`;
    await invoke("write_text_file", { path: picked, contents: html });
    void invoke("reveal_in_dir", { path: picked });
  }, [activeTabId, t]);

  const exportViaPandoc = useCallback(
    async (format: string) => {
      const info = PANDOC_FORMATS[format];
      const tab = tabsRef.current.find((t) => t.id === activeTabId);
      if (!info || !tab) return;
      const pandoc = await invoke<string | null>("detect_pandoc");
      if (!pandoc) {
        // Typora's model: guide the user to install pandoc rather than
        // bundling the ~180MB GPL binary in the app.
        const goInstall = await ask(t.pandocMissingMessage, {
          title: t.pandocMissingTitle,
          okLabel: t.pandocMissingDownload,
          cancelLabel: t.closePromptCancel,
        });
        if (goInstall) void invoke("open_pandoc_install_page");
        return;
      }
      const base = tab.path ? basename(tab.path).replace(/\.[^.]+$/, "") : tabTitle(tab, t);
      const picked = await invoke<string | null>("export_save_dialog", {
        defaultName: `${base}.${info.ext}`,
        filterName: info.label,
        ext: info.ext,
      });
      if (!picked) return;
      try {
        // tab.content, not the file on disk - unsaved edits export too.
        await invoke("export_via_pandoc", {
          pandocPath: pandoc,
          markdown: tab.content,
          outputPath: picked,
          format,
          resourceDir: tab.path ? dirname(tab.path) : null,
          title: base,
        });
        void invoke("reveal_in_dir", { path: picked });
      } catch (err) {
        await message(`${t.exportFailed} ${String(err)}`, { title: t.exportFailedTitle, kind: "error" });
      }
    },
    [activeTabId, t],
  );

  const toggleSourceMode = useCallback(() => {
    const tab = tabsRef.current.find((t) => t.id === activeTabId);
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
    const closedIndex = tabsRef.current.findIndex((t) => t.id === id);
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        void getCurrentWindow().destroy();
        return prev;
      }
      return next;
    });
    setActiveTabId((prevActive) => {
      if (prevActive !== id) return prevActive;
      const remaining = tabsRef.current.filter((t) => t.id !== id);
      if (remaining.length === 0) return prevActive;
      return remaining[Math.min(closedIndex, remaining.length - 1)].id;
    });
  }, []);

  const requestCloseTab = useCallback(
    (id: string) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab || tab.content === tab.savedContent) {
        removeTab(id);
        return;
      }
      setClosePromptTabId(id);
      setClosePromptOpen(true);
    },
    [removeTab],
  );

  const hitTestWindow = useCallback(async (screenX: number, screenY: number): Promise<string | null> => {
    const selfLabel = getCurrentWindow().label;
    try {
      const bounds = await invoke<WindowBounds[]>("list_window_bounds");
      const hit = bounds.find((b) => b.label !== selfLabel && pointInTopStrip(screenX, screenY, b));
      return hit?.label ?? null;
    } catch {
      return null;
    }
  }, []);

  // THE FLOATING TAB: the single "a tab is in flight" state both drag
  // flows funnel into - and it lives entirely in Rust
  // (start_floating_tab_drag), not here. The moment a tab is pulled past
  // the detach threshold, it leaves this window for good: its live content
  // (possibly an unsaved draft, or edits that never hit disk) is handed
  // over, the pill disappears from the bar, and Rust carries the document
  // to wherever the mouse releases - another window's tab row (pushed
  // there as a real tab, including back onto THIS window's row, which
  // simply re-inserts it), or empty space (a fresh window right at the
  // drop point). This window keeps no claim on it: the handoff is the
  // whole point, since the drag must survive this window's own DOM (and,
  // in the whole-window flow below, this window's very existence).
  const handleTabDetach = useCallback(
    async (id: string) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab) return;
      try {
        await invoke("start_floating_tab_drag", {
          path: tab.path,
          content: tab.content,
          savedContent: tab.savedContent,
          title: tabTitle(tab, t),
          dirty: tab.content !== tab.savedContent,
          destroySource: false,
        });
      } catch {
        return; // drag couldn't start (unsupported platform / one already active) - keep the tab
      }
      removeTab(id);
    },
    [removeTab, t],
  );

  // Single-tab windows have no tab bar to drag a pill out of (showTabBar
  // above), so they're merged by dragging the whole native window (its
  // title bar) onto another Levis window instead - the same gesture
  // Safari/Chrome use to combine two single-tab windows into one.
  //
  // Tauri's onMoved fires on every tick of a drag but there is no "drag
  // ended" event, and merging on anything short of the actual button
  // release is wrong (an early debounce-based version merged while the
  // user was merely holding still, mid-drag). So the FIRST onMoved of a
  // drag asks Rust to stream window-drag-tick events - real cursor
  // position + real button state, polled natively only for the duration
  // of this one drag - and this window's only job is watching those ticks
  // for the moment the cursor enters another window's tab row. At that
  // moment the window BECOMES the floating tab: its document is handed to
  // Rust (start_floating_tab_drag) and the window itself is destroyed -
  // destroy is the one window operation macOS reliably honors mid-drag
  // (hide gets ignored by the drag session, which kept the "original"
  // window visibly in hand). From there the drag is Rust's entirely, same
  // as a tab pulled from a bar: still un-merged while the button is down,
  // carried as the preview/pill, and landed wherever release happens - back
  // in open space just means a fresh window there. Release before ever
  // touching a row: it was a plain window move, nothing happens.
  const windowDragRef = useRef<"idle" | "watching" | "handed-off">("idle");

  useEffect(() => {
    const win = getCurrentWindow();

    async function handleTick(x: number, y: number, down: boolean) {
      if (!down) {
        windowDragRef.current = "idle";
        return;
      }
      if (windowDragRef.current !== "watching") return;
      const target = await hitTestWindow(x, y);
      // Re-check the phase: a tick may have finished the handoff while
      // this hit test was in flight.
      if (!target || windowDragRef.current !== "watching") return;
      const tab = tabsRef.current[0];
      if (!tab) return;
      windowDragRef.current = "handed-off";
      void invoke("start_floating_tab_drag", {
        path: tab.path,
        content: tab.content,
        savedContent: tab.savedContent,
        title: tabTitle(tab, t),
        dirty: tab.content !== tab.savedContent,
        destroySource: true,
      });
    }

    // Ticks run strictly in order - two interleaved handlers could both
    // pass the "watching" check and hand the document off twice.
    let chain: Promise<void> = Promise.resolve();
    const unlistenTick = listen<{ x: number; y: number; down: boolean }>("window-drag-tick", (event) => {
      const { x, y, down } = event.payload;
      chain = chain.then(() => handleTick(x, y, down)).catch(() => {});
    });

    const unlistenMoved = win.onMoved(() => {
      // Lazy trigger: nothing beyond this guard runs unless a SINGLE-tab
      // window actually starts moving (multi-tab windows merge via their
      // tab pills instead). Rust double-checks the button is really down -
      // a programmatic setPosition also fires onMoved - and refuses to
      // double-track, so a stray extra call here is harmless.
      if (windowDragRef.current !== "idle" || tabsRef.current.length !== 1) return;
      windowDragRef.current = "watching";
      void invoke<boolean>("start_window_drag_tracking").then((started) => {
        if (!started && windowDragRef.current === "watching") windowDragRef.current = "idle";
      });
    });

    return () => {
      void unlistenTick.then((f) => f());
      void unlistenMoved.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const detached = await invoke<{ path: string | null; content: string; savedContent: string } | null>(
        "take_detached_tab",
      );
      if (detached) {
        updateTab(activeTabId, detached);
        return;
      }
      // A Help menu doc clicked with no window open: this window was
      // spawned to show it, so the bundled document rides the blank
      // initial tab instead of opening next to it.
      const helpDoc = await invoke<string | null>("take_pending_show_help");
      if (helpDoc === "markdown" || helpDoc === "agent") {
        const content = helpDocContent(helpDoc, settings.language);
        updateTab(activeTabId, { content, savedContent: content, helpDoc });
        return;
      }
      if (settings.newDocumentMode === "tab") {
        const paths = await invoke<string[]>("take_pending_open_paths");
        if (paths.length === 0) return;
        const [first, ...rest] = paths;
        const text = await invoke<string>("read_text_file", { path: first });
        updateTab(activeTabId, { path: first, content: text, savedContent: text });
        for (const p of rest) await openPathInTab(p);
      } else {
        const pending = await invoke<string | null>("take_pending_open_path");
        if (pending) await openFile(pending);
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

  // A floating tab dropped onto this window's tab row (Rust's drag thread
  // emits it on release): lands at the slot it was hovering - the
  // insertion index is however many pills sit left of the drop point -
  // not at the end of the bar. The drag deliberately doesn't send a
  // hover-off first: the preview pill is replaced by the real tab in the
  // same render, so there's no empty-gap flash in between.
  useEffect(() => {
    const unlisten = listen<{ path: string | null; content: string; savedContent: string; x: number }>(
      "receive-detached-tab",
      (event) => {
        const { x, ...doc } = event.payload;
        const newTab = { ...makeBlankTab(), ...doc };
        const winLeft = previewWinLeftRef.current;
        let index = tabsRef.current.length;
        if (winLeft !== null) {
          const localX = x - winLeft;
          index = tabsRef.current.filter((tab) => {
            const node = document.querySelector<HTMLElement>(`[data-flip-id="${CSS.escape(tab.id)}"]`);
            if (!node) return false;
            const rect = node.getBoundingClientRect();
            return rect.left + rect.width / 2 < localX;
          }).length;
        }
        previewWinLeftRef.current = null;
        setDragHoverPreview(null);
        setTabs((prev) => {
          const next = [...prev];
          next.splice(index, 0, newTab);
          return next;
        });
        setActiveTabId(newTab.id);
      },
    );
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  // Live "a tab is being dragged along this bar" feedback for this window
  // as a MERGE TARGET - Rust's floating drag emits it every tick with the
  // global cursor x; converted here to window-local so TabBar can slide
  // the preview pill to it. Purely a receiver.
  useEffect(() => {
    const unlisten = listen<{ title: string; dirty: boolean; x: number } | null>("drag-hover", async (event) => {
      if (!event.payload) {
        previewWinLeftRef.current = null;
        setDragHoverPreview(null);
        return;
      }
      if (previewWinLeftRef.current === null) {
        const win = getCurrentWindow();
        const [pos, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
        previewWinLeftRef.current = pos.x / scale;
      }
      setDragHoverPreview({ ...event.payload, x: event.payload.x - previewWinLeftRef.current });
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

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

  useEffect(() => {
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
    const unlistenExportHtml = listen("menu-export-html", () => void exportHtml());
    // Payload is the pandoc writer name (docx, epub, ...) from the menu id.
    const unlistenExportPandoc = listen<string>("menu-export-pandoc", (event) => void exportViaPandoc(event.payload));
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
      if (event.payload === "markdown" || event.payload === "agent") openHelpTab(event.payload);
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
    requestCloseTab,
    activeTabId,
    toggleSourceMode,
    settings.typewriterMode,
    setSettings,
    exportHtml,
    exportViaPandoc,
  ]);

  const closeSaving = useCallback(async () => {
    const tabId = closePromptTabId;
    setClosePromptOpen(false);
    if (tabId === null) {
      // Whole window: save every dirty tab, aborting (leaving the window
      // open) if any of them hits a cancelled Save As.
      for (const tab of tabsRef.current) {
        if (tab.content === tab.savedContent) continue;
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
            gesture (see the onMoved effect), so knowing which document is
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
            tabs={tabs.map((tab) => ({ id: tab.id, title: tabTitle(tab, t), dirty: tab.content !== tab.savedContent }))}
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
    </div>
  );
}

export default App;
