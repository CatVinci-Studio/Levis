import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { exportHtml, exportViaPandoc } from "./export-doc";
import { TOGGLE_FIND_REPLACE_EVENT, INSERT_BLOCK_EVENT } from "./utils/events";
import type { DocTab, HelpDoc } from "./doc-tabs";
import type { Strings } from "./i18n/strings";

export interface MenuBridgeHandlers {
  activeTabId: string;
  /** Read fresh inside event handlers, not captured at effect-setup time -
   *  same reason App.tsx keeps this ref (see its own comment on tabsRef). */
  tabsRef: { readonly current: DocTab[] };
  t: Strings;
  onOpenSettings: () => void;
  onToggleTypewriter: () => void;
  onToggleSidebar: () => void;
  addBlankTab: () => void;
  openFileDialog: () => Promise<void>;
  saveTab: (tabId: string) => Promise<boolean>;
  saveTabAs: (tabId: string) => Promise<boolean>;
  toggleSourceMode: () => void;
  requestCloseTab: (tabId: string) => void;
  openHelpTab: (doc: HelpDoc) => void;
  startWelcomeTutorial: () => void;
}

/**
 * Menu events from Rust (menu.rs's dispatch) - every File/View/Format/Help
 * action the frontend owns arrives here as a window event. Pulled out of
 * App.tsx as a pure wiring layer: every handler it calls already lives in
 * App (or a hook App composes), this just subscribes/unsubscribes them to
 * the right event names.
 */
export function useMenuBridge(handlers: MenuBridgeHandlers): void {
  const {
    activeTabId,
    tabsRef,
    t,
    onOpenSettings,
    onToggleTypewriter,
    onToggleSidebar,
    addBlankTab,
    openFileDialog,
    saveTab,
    saveTabAs,
    toggleSourceMode,
    requestCloseTab,
    openHelpTab,
    startWelcomeTutorial,
  } = handlers;

  useEffect(() => {
    const activeTabNow = () =>
      tabsRef.current.find((tb) => tb.id === activeTabId);
    const unlistenSettings = listen("menu-open-settings", () =>
      onOpenSettings(),
    );
    // Only arrives in tab mode - in window mode the Rust menu handler opens
    // a fresh window itself instead of emitting this.
    const unlistenNewFile = listen("menu-new-file", () => addBlankTab());
    const unlistenOpenFile = listen(
      "menu-open-file",
      () => void openFileDialog(),
    );
    const unlistenSaveFile = listen(
      "menu-save-file",
      () => void saveTab(activeTabId),
    );
    const unlistenSaveFileAs = listen(
      "menu-save-file-as",
      () => void saveTabAs(activeTabId),
    );
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
    const unlistenExportPandoc = listen<string>(
      "menu-export-pandoc",
      (event) => {
        const tab = activeTabNow();
        if (tab) void exportViaPandoc(tab, event.payload, t);
      },
    );
    const unlistenSourceMode = listen("menu-toggle-source-mode", () =>
      toggleSourceMode(),
    );
    const unlistenTypewriter = listen("menu-toggle-typewriter-mode", () =>
      onToggleTypewriter(),
    );
    const unlistenSidebar = listen("menu-toggle-sidebar", () =>
      onToggleSidebar(),
    );
    const unlistenFindReplace = listen("menu-find-replace", () =>
      window.dispatchEvent(new CustomEvent(TOGGLE_FIND_REPLACE_EVENT)),
    );
    const unlistenCloseTab = listen("menu-close-tab", () =>
      requestCloseTab(activeTabId),
    );
    // Payload is the block kind (h1..h6, bullet-list, ...) from the menu id -
    // relayed to whichever editor is mounted as active (see MilkdownEditor.tsx).
    const unlistenInsertBlock = listen<string>("menu-insert-block", (event) => {
      window.dispatchEvent(
        new CustomEvent(INSERT_BLOCK_EVENT, { detail: event.payload }),
      );
    });
    const unlistenHelp = listen<string>("menu-open-help", (event) => {
      if (event.payload === "welcome") startWelcomeTutorial();
      else if (event.payload === "markdown" || event.payload === "agent")
        openHelpTab(event.payload);
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
    onOpenSettings,
    onToggleTypewriter,
    onToggleSidebar,
    tabsRef,
    t,
  ]);
}
