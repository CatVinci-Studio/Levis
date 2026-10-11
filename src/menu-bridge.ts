import { useEffect } from "react";
import { listenToThisWindow, unlistenAll } from "./utils/tauri-events";
import { exportHtml, exportPdf, exportViaPandoc } from "./export-doc";
import { TOGGLE_FIND_REPLACE_EVENT, INSERT_BLOCK_EVENT } from "./utils/events";
import type { DocTab, HelpDoc } from "./doc-tabs";
import type { Strings } from "./i18n/strings";

export interface MenuBridgeHandlers {
  activeTabId: string;
  /** App.tsx's liveTabs: read inside event handlers, not captured at
   *  effect-setup time, and with the editors' pending edits flushed so an
   *  export carries what is on screen. */
  liveTabs: () => DocTab[];
  t: Strings;
  onOpenSettings: () => void;
  onToggleTypewriter: () => void;
  onToggleSidebar: () => void;
  onToggleAgentPanel: () => void;
  onToggleSplitView: () => void;
  onToggleZenMode: () => void;
  addBlankTab: () => void;
  openFileDialog: () => Promise<void>;
  saveTab: (tabId: string) => Promise<boolean>;
  saveTabAs: (tabId: string) => Promise<boolean>;
  toggleSourceMode: () => void;
  requestCloseTab: (tabId: string) => void;
  openHelpTab: (doc: HelpDoc) => void;
  startWelcomeTutorial: () => void;
  /** The phone menu's Documents (mobile/DocumentList.tsx). */
  onOpenDocuments: () => void;
  /** The phone menu's Share (iOS share sheet). */
  shareActiveTab: () => Promise<void>;
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
    liveTabs,
    t,
    onOpenSettings,
    onToggleTypewriter,
    onToggleSidebar,
    onToggleAgentPanel,
    onToggleSplitView,
    onToggleZenMode,
    addBlankTab,
    openFileDialog,
    saveTab,
    saveTabAs,
    toggleSourceMode,
    requestCloseTab,
    openHelpTab,
    startWelcomeTutorial,
    onOpenDocuments,
    shareActiveTab,
  } = handlers;

  useEffect(() => {
    const activeTabNow = () => liveTabs().find((tb) => tb.id === activeTabId);
    return unlistenAll(
      listenToThisWindow("menu-open-settings", () => onOpenSettings()),
      // Only arrives in tab mode - in window mode the Rust menu handler opens
      // a fresh window itself instead of emitting this.
      listenToThisWindow("menu-new-file", () => addBlankTab()),
      listenToThisWindow("menu-open-file", () => void openFileDialog()),
      listenToThisWindow("menu-documents", () => onOpenDocuments()),
      listenToThisWindow("menu-share", () => void shareActiveTab()),
      listenToThisWindow("menu-save-file", () => void saveTab(activeTabId)),
      listenToThisWindow(
        "menu-save-file-as",
        () => void saveTabAs(activeTabId),
      ),
      // Dedicated PDF export: shows a progress overlay while the themed,
      // paginated document is rendered offscreen and written straight to
      // the chosen file (no print dialog). See exportPdf in export-doc.
      listenToThisWindow("menu-export-pdf", () => {
        const tab = activeTabNow();
        if (tab) void exportPdf(tab, t);
      }),
      listenToThisWindow("menu-export-html", () => {
        const tab = activeTabNow();
        if (tab) void exportHtml(tab, t);
      }),
      // Payload is the pandoc writer name (docx, epub, ...) from the menu id.
      listenToThisWindow<string>("menu-export-pandoc", (event) => {
        const tab = activeTabNow();
        if (tab) void exportViaPandoc(tab, event.payload, t);
      }),
      listenToThisWindow("menu-toggle-source-mode", () => toggleSourceMode()),
      listenToThisWindow("menu-toggle-typewriter-mode", () =>
        onToggleTypewriter(),
      ),
      listenToThisWindow("menu-toggle-sidebar", () => onToggleSidebar()),
      listenToThisWindow("menu-toggle-agent-panel", () => onToggleAgentPanel()),
      listenToThisWindow("menu-find-replace", () =>
        window.dispatchEvent(new CustomEvent(TOGGLE_FIND_REPLACE_EVENT)),
      ),
      listenToThisWindow("menu-close-tab", () => requestCloseTab(activeTabId)),
      // Payload is the block kind (h1..h6, bullet-list, ...) from the menu id -
      // relayed to whichever editor is mounted as active (MilkdownEditor.tsx).
      listenToThisWindow<string>("menu-insert-block", (event) => {
        window.dispatchEvent(
          new CustomEvent(INSERT_BLOCK_EVENT, { detail: event.payload }),
        );
      }),
      listenToThisWindow<string>("menu-open-help", (event) => {
        if (event.payload === "welcome") startWelcomeTutorial();
        else if (event.payload === "markdown" || event.payload === "agent")
          openHelpTab(event.payload);
      }),
    );
  }, [
    openFileDialog,
    onOpenDocuments,
    shareActiveTab,
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
    onToggleAgentPanel,
    onToggleSplitView,
    onToggleZenMode,
    liveTabs,
    t,
  ]);
}
