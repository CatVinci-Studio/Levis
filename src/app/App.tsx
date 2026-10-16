import { useCallback, useEffect, useState } from "react";
import { AppDialogHost } from "../ui/app-dialog";
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
import { EditorPane } from "../document-view/EditorPane";
import { ActionSheet } from "../ui/ActionSheet";
import { TutorialExperience } from "../onboarding/TutorialExperience";
import { LanguageWelcome } from "../onboarding/LanguageWelcome";
import { TabBar } from "./TabBar";
import { tabIsDirty, tabTitle } from "../document/doc-tabs";
import { SplitView } from "../editor/modes/SplitView";
import { SourceTextarea } from "../editor/modes/SourceTextarea";
import { installClipboardCapture } from "../clipboard/history";
import { canDragTabsBetweenWindows, isIOSApp } from "../platform/capabilities";
import { SettingsPanel } from "../settings/SettingsPanel";
import { DocumentList } from "../mobile/DocumentList";
import { KeyboardToolbar } from "../mobile/KeyboardToolbar";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import { useSettings } from "../settings/SettingsContext";
import { useTutorial } from "../onboarding/useTutorial";
import { useTutorialDocumentEvaluation } from "../onboarding/useTutorialDocumentEvaluation";
import { formatCombo } from "../utils/shortcuts";
import { useAppUpdate } from "./useAppUpdate";
import { useZoom } from "./useZoom";
import { useTabDragMerge } from "./useTabDragMerge";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { useExternalChangeReload } from "../document/useExternalChangeReload";
import { useDraftAutosave } from "../document/draft-autosave";
import { useMenuBridge, useNativeMenuChecks } from "./menu-bridge";
import { useStartupRestore } from "../document/startup-restore";
import { Presence, PresenceDiv } from "../ui/usePresence";
import { FlipOnChange } from "../ui/flip";
import {
  AgentPanelProvider,
  AgentPanelResizer,
  AgentPanelSheetGrip,
} from "../ai/chat/panel/agent-panel";
import { useTabState } from "./useTabState";
import { useSidePanels } from "./useSidePanels";
import { useActiveDocument } from "./useActiveDocument";
import { useSessionPaths, useWindowTitle } from "./useWindowSession";
import { useFileOpening, useOpenPathsPush } from "./useFileOpening";
import { useHelpTabs } from "./useHelpTabs";
import { useSaveTabs } from "./useSaveTabs";
import { useZenMode } from "./useZenMode";
import { useSourceModes } from "./useSourceModes";
import { useDocumentActions } from "./useDocumentActions";
import {
  useClosePrompt,
  useTabRemoval,
  useWindowCloseGuard,
  type PendingClose,
} from "./close-flow";
import {
  useLevisOffer,
  usePracticeTab,
  useSidebarLesson,
  useTutorialTabRecovery,
} from "./onboarding-wiring";
import "./App.css";

/**
 * One window: its tabs, the panels around them, and the prompts and
 * notices over them. Each concern lives in its own hook or component in
 * this folder; this is where they meet. The hooks keep the order they had
 * when all of this was one function, so their effects still run in it.
 */
function App() {
  const { t, settings, setSettings } = useSettings();
  const levisOffer = useLevisOffer({
    t,
    settings,
    setSettings,
    exitTutorial: () => tutorial.exit(),
  });
  const tabState = useTabState();
  const { tabs, setTabs, activeTabId, setActiveTabId, tabsRef, liveTabs } =
    tabState;
  const { updateTab, reorderTab, addBlankTab } = tabState;
  // The one save/discard/cancel prompt (close-flow.ts's PendingClose).
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const {
    panelOpen,
    setPanelOpen,
    toggleSidebar,
    agentPanel,
    agentOverlays,
    agentPanelEl,
    setAgentPanelEl,
    toggleAgentPanel,
    sidebarPresence,
    sidebarClosing,
    agentPresence,
    agentClosing,
    sheetFull,
    setSheetFull,
    panelMode,
    setPanelMode,
  } = useSidePanels();
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

  const {
    activeTab,
    rootPath,
    wordCount,
    isLargeDoc,
    activeDirty,
    activeTitle,
  } = useActiveDocument(tabs, activeTabId, t);
  useWindowTitle(activeTitle);
  useSessionPaths(tabs);

  const { openPathInTab, replaceTabWithFile, openFile, openFileDialog } =
    useFileOpening({
      tabState,
      newDocumentMode: settings.newDocumentMode,
      setPendingClose,
    });

  const { openHelpTab } = useHelpTabs({
    tabState,
    language: settings.language,
    stopTutorial,
  });

  const { claimPracticeTab, startWelcomeTutorial } = usePracticeTab(
    tabState,
    startTutorial,
  );

  const handleChange = useCallback(
    (tabId: string, markdown: string) => {
      updateTab(tabId, { content: markdown });
      evaluateTutorialDocumentChange(tabId, markdown);
    },
    [updateTab, evaluateTutorialDocumentChange],
  );

  const { saveTab, saveTabAs } = useSaveTabs({
    tabState,
    t,
    autoSuggestFilename: settings.autoSuggestFilename,
  });

  const { zenMode, setZenMode, toggleZenMode } = useZenMode();
  const { toggleSourceMode, toggleSplitView } = useSourceModes(tabState);

  const { removeTab, requestCloseTab } = useTabRemoval({
    tabState,
    cancelDraftFlushes,
    setPendingClose,
  });

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

  useTutorialTabRecovery(tutorial, tabState, claimPracticeTab);

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

  // The same, pushed to an already-running window (useFileOpening.ts).
  useOpenPathsPush(openPathInTab);

  useWindowCloseGuard(liveTabs, setPendingClose);

  useExternalChangeReload(liveTabs, updateTab);

  const {
    documentsOpen,
    setDocumentsOpen,
    openFromDocuments,
    documentRenamed,
    documentDeleted,
    skillFilesDeleted,
    shareActiveTab,
  } = useDocumentActions({ tabState, openFile, removeTab, saveTab });

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
    onOpenDocuments: () => setDocumentsOpen(true),
    shareActiveTab,
  });

  const sidebarLesson = useSidebarLesson({
    tutorial,
    languageChosen: settings.languageChosen,
    panelMode,
    setPanelOpen,
  });

  const { closeSaving, closeDiscarding, cancelClose, closePrompt } =
    useClosePrompt({
      pendingClose,
      setPendingClose,
      tabState,
      cancelDraftFlushes,
      saveTab,
      removeTab,
      replaceTabWithFile,
    });
  const phone = usePhoneLayout();

  return (
    <AgentPanelProvider
      // The conversation stays in the panel while it plays its exit.
      open={agentPresence.mounted}
      setOpen={agentPanel.setOpen}
      container={agentPanelEl}
      tab={agentPanel.tab}
      setTab={agentPanel.setTab}
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
