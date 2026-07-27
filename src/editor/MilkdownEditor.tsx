import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  commandsCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  type CmdKey,
} from "@milkdown/kit/core";
import {
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
  wrapInHeadingCommand,
} from "@milkdown/kit/preset/commonmark";
import { insertTableCommand } from "@milkdown/kit/preset/gfm";
import {
  isInTable,
  addRowAfter,
  addRowBefore,
  addColumnAfter,
  addColumnBefore,
  deleteRow,
  deleteColumn,
  deleteTable,
  setCellAttr,
  CellSelection,
  selectionCell,
} from "@milkdown/kit/prose/tables";
import {
  TextSelection,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { listenerCtx } from "@milkdown/kit/plugin/listener";
import {
  withEditorExtensions,
  type PendingEditCallbacks,
} from "./editor-extensions";
import { GrammarPopover } from "../ai/GrammarPopover";
import { InlineChat } from "../ai/chat/InlineChat";
import { chatLabels } from "../ai/chat/chat-labels";
import { useDetachedChat } from "../ai/chat/useDetachedChat";
import { readChatContext } from "../ai/chat/live-context";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { InsertTableDialog } from "./InsertTableDialog";
import { FindReplaceBar } from "./FindReplaceBar";
import { useFindReplace } from "./useFindReplace";
import { useEditorRunner } from "./useEditorRunner";
import { useEditorClipboard } from "./useEditorClipboard";
import { useAiActions } from "../ai/useAiActions";
import { useAgentConversation } from "../ai/useAgentConversation";
import { blockPositionAfter, useInlineChat } from "../ai/useInlineChat";
import { setChatSelection } from "../ai/chat-selection-plugin";
import { setQuickAskWidget } from "../ai/quick-ask-widget-plugin";
import { usePendingEdits, type SelectionTarget } from "../ai/usePendingEdits";
import {
  prefersReducedMotion,
  streamPendingInsertText,
  type PendingPreview,
} from "../ai/pending-edit-plugin";
import { draftProposal } from "../ai/chat/partial-tool-args";
import { parseProposal } from "../ai/chat/proposal";
import type { StreamEvent } from "../ipc";
import { useGrammarPopover } from "../ai/useGrammarPopover";
import { useSettings } from "../settings/SettingsContext";
import { useLatest } from "../utils/useLatest";
import { useWindowEvent } from "../utils/useWindowEvent";
import { normalizeMathDelimiters } from "../utils/markdown-math";
import { createTutorialMockAgent } from "../onboarding/tutorial-mock-agent";
import {
  TRIGGER_COMPLETION_EVENT,
  TRIGGER_GRAMMAR_CHECK_EVENT,
  TOGGLE_FLOATING_CHAT_EVENT,
  TOGGLE_FIND_REPLACE_EVENT,
  INSERT_CLIPBOARD_TEXT_EVENT,
  RESTORE_CHAT_EVENT,
  INSERT_BLOCK_EVENT,
  TUTORIAL_MOCK_GHOST_EVENT,
  TUTORIAL_MOCK_GRAMMAR_EVENT,
} from "../utils/events";
import { showGhostSuggestion } from "../ai/ghost-text-plugin";
import { showGrammarIssues } from "../ai/grammar-check-plugin";
import {
  anchorGrammarIssues,
  type TutorialGrammarMock,
} from "../onboarding/tutorial-evaluation";
import type { ChatHistoryEntry } from "../ai/chat-history";
import type { EditProposal } from "../ai/types";
import { Milkdown, useEditor } from "@milkdown/react";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "katex/dist/katex.min.css";
import "./milkdown-theme.css";
import "./content-themes.css";

interface MilkdownEditorProps {
  filePath: string | null;
  initialValue: string;
  onChange: (markdown: string) => void;
  /** The tab's display name (doc-tabs' `tabTitle`) - what the detached chat
   *  window puts in its title bar. Passed down rather than derived from
   *  `filePath`, which is null for the bundled Help documents. */
  docTitle: string;
  /** Whether this is the tab the user is looking at. Every open tab stays
   *  mounted (App.tsx hides the rest with display:none), so the detached
   *  chat - which follows the ACTIVE document - needs to know which of them
   *  should be feeding it. */
  isActive?: boolean;
  /** True while the onboarding tour runs: real AI is muted end to end -
   *  typing-triggered plugins go quiet (editor-extensions), on-demand
   *  triggers are ignored, and the chat answers from a pre-written script
   *  instead of the backend. First-run users have no AI account yet. */
  tutorialMock?: boolean;
}

export function MilkdownEditor({
  filePath,
  docTitle,
  initialValue,
  onChange,
  isActive = true,
  tutorialMock = false,
}: MilkdownEditorProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  // The Quick Ask zone widget's DOM container (quick-ask-widget-plugin) -
  // null whenever no widget is in the document. InlineChat portals into it,
  // so the panel's actual pixels sit wherever ProseMirror placed the
  // decoration (in the document flow, pushing content below it down).
  const [quickAskEl, setQuickAskEl] = useState<HTMLElement | null>(null);
  const { t, settings } = useSettings();

  // The editor plugin chain below is only built once (empty deps), so
  // plugins read this ref to see live settings instead of the value
  // captured at construction time.
  const settingsRef = useLatest(settings);
  const filePathRef = useLatest(filePath);
  const docTitleRef = useLatest(docTitle);
  const isActiveRef = useLatest(isActive);
  const tutorialMockRef = useLatest(tutorialMock);
  const tRef = useLatest(t);

  // The pending-edit plugin's callbacks need to exist at chain-construction
  // time below, but the real accept/reject/sync functions come from
  // usePendingEdits, which needs `run` - only available after useEditor sets
  // up the Milkdown instance. This ref bridges the gap the same way
  // settingsRef/filePathRef do: a stable object the plugin reads `.current`
  // off of at call time (user interaction, well after mount), kept fresh by
  // the effect further down.
  const pendingEditActionsRef = useRef<PendingEditCallbacks>({
    onAccept: () => {},
    onReject: () => {},
    onPreviewsChange: () => {},
    getFocusedCallId: () => null,
  });
  // Same bridge, for the selection listener registered in the chain below:
  // the real handler needs `run` and the detached-chat bridge, neither of
  // which exists yet at construction time.
  const onSelectionChangeRef = useRef<() => void>(() => {});

  useEditor(
    (root) =>
      withEditorExtensions(
        Editor.make().config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, normalizeMathDelimiters(initialValue));
          // Typora-compatible themes style their content under `#write` -
          // aliasing it here lets most community Typora themes' CSS apply
          // directly to our content with no rewriting.
          ctx.set(editorViewOptionsCtx, { attributes: { id: "write" } });
          ctx
            .get(listenerCtx)
            .markdownUpdated((_ctx, markdown) => onChange(markdown))
            // Every new selection has to reach the detached chat window as a
            // fresh selection chip - that surface is defined by following
            // the user's work rather than a snapshot. Read through a ref
            // because this chain is built once, on mount.
            .selectionUpdated(() => onSelectionChangeRef.current());
        }),
        settingsRef,
        filePathRef,
        {
          onAccept: (callId) => pendingEditActionsRef.current.onAccept(callId),
          onReject: (callId) => pendingEditActionsRef.current.onReject(callId),
          onPreviewsChange: (previews) =>
            pendingEditActionsRef.current.onPreviewsChange(previews),
          getFocusedCallId: () =>
            pendingEditActionsRef.current.getFocusedCallId(),
        },
        // setQuickAskEl is a useState setter - always stable, no ref
        // indirection needed (unlike pendingEdits above, whose real
        // callbacks don't exist yet at chain-construction time). The
        // unmount only clears if the element going away is still the
        // current one; see the plugin's onUnmount for why that matters.
        {
          onMount: setQuickAskEl,
          onUnmount: (el) =>
            setQuickAskEl((current) => (current === el ? null : current)),
        },
        tutorialMockRef,
        () => tRef.current.imagePasteFailedMessage,
      ),
    [],
  );

  const run = useEditorRunner();
  const { copyOrCut, paste, selectAll, insertText } = useEditorClipboard(run);

  // Transient, self-dismissing notice for on-demand AI triggers ("no issues
  // found", "not signed in", ...) - deliberately not a native alert():
  // those block the whole webview (and freeze automation) over messages
  // that are often benign.
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const showAiNotice = useCallback((message: string) => {
    setAiNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setAiNotice(null), 4000);
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const { triggerCompletion, triggerGrammarCheck } = useAiActions(
    run,
    () => settingsRef.current,
    showAiNotice,
  );
  const inlineChat = useInlineChat(run);
  // Keep the text the chat was opened over visibly marked for as long as
  // the chat context lives (popup or detached window) - the native
  // selection paint is gone the moment the composer takes focus.
  const chatRange = inlineChat.chatInfo?.range ?? null;
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(setChatSelection(view.state.tr, chatRange));
    });
  }, [chatRange, run]);
  // Shows/hides the Quick Ask zone widget. Keyed on `visible` alone (NOT
  // chatInfo.widgetPos) - once shown, the plugin remaps the widget's
  // position through edits on its own; re-running this on every chatInfo
  // change would snap it back to the position captured at open time and
  // undo that tracking. `visible` transitioning true is exactly "just
  // opened (or reopened)", which is the only moment a fresh position makes
  // sense - `open()` always sets both chatInfo and visible together.
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(
        setQuickAskWidget(
          view.state.tr,
          inlineChat.visible ? (inlineChat.chatInfo?.widgetPos ?? null) : null,
        ),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineChat.visible, run]);
  const pendingEdits = usePendingEdits(run);
  useEffect(() => {
    pendingEditActionsRef.current = {
      onAccept: pendingEdits.accept,
      onReject: pendingEdits.reject,
      onPreviewsChange: pendingEdits.syncFromPlugin,
      getFocusedCallId: () => pendingEdits.focusedPreview?.callId ?? null,
    };
  }, [
    pendingEdits.accept,
    pendingEdits.reject,
    pendingEdits.syncFromPlugin,
    pendingEdits.focusedPreview,
  ]);
  // A streaming propose_edit grows its green preview in the document while
  // the model is still writing it: argument fragments accumulate here, the
  // preview is placed as soon as the action+anchor are complete
  // (partial-tool-args), and the text after that goes straight into the
  // widget's typewriter (streamPendingInsertText). The final ToolCall turn
  // then delivers the authoritative proposal (ChatBody re-shows it without
  // the streaming flag). Gated on the animation setting: off means previews
  // appear complete, at once.
  const streamedProposals = useRef(
    new Map<string, { args: string; placed: boolean }>(),
  );
  const handleStreamEvent = useCallback(
    (event: StreamEvent) => {
      // Reduced motion renders widgets instantly, so streamed drafts would
      // create animation entries nothing ever reveals (or settles).
      if (!settingsRef.current.enableEditAnimation || prefersReducedMotion())
        return;
      const drafts = streamedProposals.current;
      if (event.type === "toolStart") {
        if (event.name === "propose_edit")
          drafts.set(event.callId, { args: "", placed: false });
      } else if (event.type === "toolArgsDelta") {
        const draft = drafts.get(event.callId);
        if (!draft) return;
        draft.args += event.delta;
        const parsed = draftProposal(draft.args);
        if (!parsed) return;
        if (!draft.placed) {
          draft.placed = true;
          pendingEdits.showPreviews(
            [
              {
                callId: event.callId,
                proposal: parsed.proposal,
                streaming: true,
              },
            ],
            inlineChat.chatInfoRef.current,
          );
        }
        streamPendingInsertText(
          event.callId,
          parsed.proposal.text ?? "",
          false,
        );
      } else if (
        event.type === "turn" &&
        event.turn.kind === "ToolCall" &&
        event.turn.name === "propose_edit"
      ) {
        drafts.delete(event.turn.call_id);
        const proposal = parseProposal(event.turn.arguments);
        // Closes the reveal even for a proposal that carries no text at all -
        // a `delete` never has any. Its arguments still streamed through the
        // branch above, which left an animation entry marked "more text may
        // come"; without this final call that entry stays un-done forever,
        // the preview stays in the un-decidable `streaming` state, and the
        // accept/reject bar never appears for that edit.
        if (proposal)
          streamPendingInsertText(
            event.turn.call_id,
            proposal.text ?? "",
            true,
          );
      }
    },
    // settingsRef/chatInfoRef are stable refs; showPreviews is stable per
    // editor (useCallback on `run`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingEdits.showPreviews],
  );
  // Owned here rather than by the popup so a completed exchange can be saved
  // to history when the popup closes. Every ordinary NEW open resets it;
  // sidebar history restoration is the one path that deliberately resumes.
  const agentModel = settings.agentModels[settings.aiProvider] || undefined;
  const conversation = useAgentConversation(
    filePath,
    settings.agentWorkspaceRoot || null,
    settings.aiProvider,
    settings.enableWebSearch,
    agentModel,
    tutorialMock ? createTutorialMockAgent(t) : null,
    handleStreamEvent,
  );
  // A send that ended without its propose_edit calls completing (stopped
  // mid-stream, or the request failed) must not leave a half-written,
  // un-acceptable preview in the document.
  useEffect(() => {
    if (conversation.busy) return;
    const drafts = streamedProposals.current;
    for (const [callId, draft] of drafts) {
      if (draft.placed) pendingEdits.reject(callId);
    }
    drafts.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.busy, pendingEdits.reject]);
  // Proposals always resolve HERE, whether the chat that produced them is
  // the embedded popup or a detached window - one implementation of the
  // anchor/apply logic, addressed two ways (see chat-bridge.ts).
  const showProposals = useCallback(
    (proposals: { callId: string; proposal: EditProposal }[]) => {
      pendingEdits.showPreviews(proposals, inlineChat.chatInfoRef.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingEdits.showPreviews],
  );

  // The selection this window last SENT to the detached chat. A
  // replace_selection proposal from that window has to resolve against it
  // and not against Quick Ask's snapshot: the window is the cross-file
  // surface, so the tab it is asking about may never have opened Quick Ask
  // at all, and chatInfo would then be null - the rewrite would come back
  // un-appliable with nothing on screen explaining why.
  const sentSelection = useRef<SelectionTarget | null>(null);

  // Every open tab in this window receives the chat's events, and with one
  // chat window serving several files they are NOT all for this tab.
  // Matching on the path the chat addressed is exact whenever the document
  // has one; an unsaved draft has no path to match, so the active tab (the
  // only one the chat could have been showing) stands in.
  const isChatTarget = useCallback(
    (docPath: string | null) =>
      docPath !== null ? docPath === filePathRef.current : isActiveRef.current,
    // filePathRef/isActiveRef are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const detachedChat = useDetachedChat({
    onProposals: (proposals, docPath) => {
      if (isChatTarget(docPath))
        pendingEdits.showPreviews(proposals, sentSelection.current);
    },
    onAccept: (callId, docPath) => {
      if (isChatTarget(docPath)) pendingEdits.accept(callId);
    },
    onReject: (callId, docPath) => {
      if (isChatTarget(docPath)) pendingEdits.reject(callId);
    },
    onAcceptAll: (docPath) => {
      if (isChatTarget(docPath)) pendingEdits.acceptAll();
    },
    onRejectAll: (docPath) => {
      if (isChatTarget(docPath)) pendingEdits.rejectAll();
    },
    // A send is about to go out and needs the document as it reads NOW - not
    // as it read when the selection last changed. Forced: the selection is
    // usually unchanged, but the document almost certainly isn't.
    onContextRequest: () => forcePushLiveContextRef.current(),
    // The window handed its conversation back on close - carry on with it
    // in the Quick Ask bar (which shows the last reply's one-line summary)
    // rather than dropping the exchange. Reopening the full conversation is
    // the same explicit detach step as any other Quick Ask.
    onReembed: (conversationId, turns) => {
      if (turns.length > 0)
        conversation.restore({
          id: conversationId,
          docPath: filePathRef.current,
          title: "",
          updatedAt: Date.now(),
          turns,
        });
      inlineChat.open();
    },
  });

  // Destructured so the effects below can depend on the individual, stable
  // callbacks. The hook's return value is a fresh object literal each render,
  // and depending on THAT re-ran these every render - emitting a bridge event
  // per render rather than per actual change.
  const {
    chatLabel: detachedChatLabel,
    pushContext: pushChatContext,
    pushStatuses: pushChatStatuses,
  } = detachedChat;

  // The detached window holds no editor state of its own: what it shows is
  // whatever the ACTIVE editor last told it. Pushing from here is therefore
  // also how the window learns which file it is about - one message carries
  // the document, the live selection, the title and the reply address (see
  // chat-bridge.ts).
  //
  // Only the active tab may push. Otherwise every hidden tab in the window
  // would announce its own document too, and the last one to render would
  // win - the chat would show a file the user isn't looking at.
  //
  // What was last sent, so a push saying nothing new can be skipped. The
  // whole document is cheap to re-read (live-context caches it against the
  // ProseMirror doc, which is immutable), but the emit JSON-encodes it and
  // the chat window re-renders on receipt - and ProseMirror reports a
  // selection change for EVERY transaction, so typing and drag-selecting
  // would each fire one per keystroke/mousemove.
  const pushed = useRef<{ selection: string; docPath: string | null } | null>(
    null,
  );
  const pushLiveContext = useCallback(() => {
    if (!detachedChatLabel || !isActiveRef.current) return;
    const live = readChatContext(
      run,
      filePathRef.current,
      docTitleRef.current,
      getCurrentWindow().label,
    );
    if (!live) return;
    const selection = live.context.selectedText ?? "";
    if (
      pushed.current?.selection === selection &&
      pushed.current.docPath === live.context.docPath
    ) {
      return;
    }
    pushed.current = { selection, docPath: live.context.docPath };
    // Remembered here, not derived later: this is the selection the chat was
    // actually shown, and a replace_selection proposal coming back is checked
    // for staleness against exactly it.
    sentSelection.current = live.selection;
    pushChatContext(live.context);
    // run is stable per editor; filePathRef/isActiveRef are refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detachedChatLabel, pushChatContext, run]);

  /** Re-sends even when nothing the guard tracks has changed - for the two
   *  callers where something ELSE did: the document (a send is imminent) or
   *  which tab is active. */
  const forcePushLiveContext = useCallback(() => {
    pushed.current = null;
    pushLiveContext();
  }, [pushLiveContext]);
  const forcePushLiveContextRef = useLatest(forcePushLiveContext);

  // A new selection becomes a new chip in the detached window - "re-drag to
  // highlight and it goes in" is the behaviour that separates this surface
  // from the in-document Quick Ask bar, which keeps its opening snapshot.
  onSelectionChangeRef.current = pushLiveContext;

  // Becoming the active tab, or saving under a new path, re-points the chat
  // at this document.
  useEffect(() => {
    forcePushLiveContext();
  }, [forcePushLiveContext, isActive, filePath]);

  // Only the active tab reports statuses, for the same reason it is the only
  // one that pushes context: otherwise every hidden tab broadcasts its own
  // and whichever rendered last wins.
  useEffect(() => {
    if (detachedChatLabel && isActive)
      pushChatStatuses(pendingEdits.allStatuses);
  }, [detachedChatLabel, isActive, pushChatStatuses, pendingEdits.allStatuses]);

  /** Scrolls to a pending edit and, while Quick Ask is the active surface,
   *  moves its zone widget to follow - the direct, synchronous result of a
   *  nav-bar click (Next/Previous/Accept/Reject), never a background
   *  reaction to something else changing (see the call sites below). */
  function revealPreview(preview: PendingPreview) {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { doc } = view.state;
      // near(), not create(): an anchored proposal's `from` is the position
      // BEFORE a block node, which is not a valid text position - create()
      // throws there. near() snaps to the closest one it can select.
      let tr = view.state.tr
        .setSelection(TextSelection.near(doc.resolve(preview.from)))
        .scrollIntoView();
      if (inlineChat.visible) {
        tr = setQuickAskWidget(tr, blockPositionAfter(doc, preview.from));
      }
      view.dispatch(tr);
      view.focus();
    });
  }

  function handleFocusNext() {
    const preview = pendingEdits.focusNext();
    if (preview) revealPreview(preview);
  }

  function handleFocusPrevious() {
    const preview = pendingEdits.focusPrevious();
    if (preview) revealPreview(preview);
  }

  // Accept/reject-focused change WHICH preview is decidable (not just the
  // pointer within a fixed set, unlike Next/Previous above), so where the
  // pointer lands next depends on usePendingEdits' own reindex effect
  // running first - there's no new preview to reveal synchronously here.
  // `revealArmed` bridges that one-render gap: armed right before the
  // action, consumed by the effect below once `focusedPreview` actually
  // updates. The same flag is armed once per batch of edits arriving (0 ->
  // >0 pending), so the first edit is revealed without the user having to
  // click Next first - after that, only an explicit nav/decide action moves
  // the panel again (see [[ui-no-auto-jump-preference]]).
  const revealArmed = useRef(false);
  const hadPendingRef = useRef(false);
  useEffect(() => {
    const hasPending = pendingEdits.decidable.length > 0;
    if (hasPending && !hadPendingRef.current) revealArmed.current = true;
    hadPendingRef.current = hasPending;
  }, [pendingEdits.decidable.length]);
  useEffect(() => {
    if (!revealArmed.current) return;
    revealArmed.current = false;
    if (pendingEdits.focusedPreview) revealPreview(pendingEdits.focusedPreview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEdits.focusedPreview]);

  function handleAcceptFocused() {
    revealArmed.current = true;
    pendingEdits.acceptFocused();
  }

  function handleRejectFocused() {
    revealArmed.current = true;
    pendingEdits.rejectFocused();
  }

  function handleDetachChat() {
    // The window opens against the document as it reads NOW, not against the
    // snapshot Quick Ask took when it opened - it is the cross-file surface
    // and starts by following this file, so it must start from the truth.
    const live = readChatContext(
      run,
      filePath,
      docTitle,
      getCurrentWindow().label,
    );
    if (!live) return;
    sentSelection.current = live.selection;
    void detachedChat.detach(
      {
        context: live.context,
        conversationId: conversation.conversationId,
        turns: conversation.history,
        statuses: pendingEdits.allStatuses,
      },
      t.chatWindowTitle,
      {
        shared: settings.shareAgentWindowAcrossWindows,
        pinned: settings.pinAgentWindow,
      },
    );
    // The Quick Ask bar gives way to the window; chatInfo stays set so
    // proposals arriving from the window still resolve against this
    // request's context.
    inlineChat.hide();
  }

  function openNewAgentConversation() {
    conversation.reset();
    inlineChat.open();
  }

  function toggleNewAgentConversation() {
    if (inlineChat.chatInfo) inlineChat.close();
    else openNewAgentConversation();
  }
  const grammar = useGrammarPopover(run, () => t.grammarApplyStale);
  const findReplace = useFindReplace(run);

  // Every open tab's editor stays mounted (App.tsx hides the inactive ones
  // with display:none, which nulls offsetParent) but the window events below
  // all mean "act on the editor the user is looking at" - without this guard
  // each fires in EVERY tab: a clipboard-history click inserts into every
  // document, a chat toggle toggles per-editor chats out of sync, and so on.
  const isOnScreen = useCallback(
    () =>
      run((ctx) => ctx.get(editorViewCtx).dom.offsetParent !== null) ?? false,
    [run],
  );

  // Shortcuts respect the same feature toggles as the context menu items -
  // a feature turned off in Settings is off through every entry point.
  // The two backend-calling triggers are also ignored while the tutorial
  // mocks AI; the chat stays available - it answers from the mock script.
  useWindowEvent(
    TRIGGER_COMPLETION_EVENT,
    () =>
      isOnScreen() &&
      !tutorialMock &&
      settings.enableCompletion &&
      triggerCompletion(),
  );
  useWindowEvent(
    TRIGGER_GRAMMAR_CHECK_EVENT,
    () =>
      isOnScreen() &&
      !tutorialMock &&
      settings.enableGrammarCheck &&
      triggerGrammarCheck(),
  );
  useWindowEvent(
    TOGGLE_FLOATING_CHAT_EVENT,
    () =>
      isOnScreen() &&
      (settings.enableAskAi || tutorialMock) &&
      toggleNewAgentConversation(),
  );
  useWindowEvent(
    TOGGLE_FIND_REPLACE_EVENT,
    () => isOnScreen() && findReplace.toggle(),
  );

  // The tutorial's completion step: the user typed the target text, show
  // the pre-written continuation as ghost text (Tab-accept and clear-on-
  // edit come from the real plugin - only the request is mocked).
  useWindowEvent(TUTORIAL_MOCK_GHOST_EVENT, (e) => {
    if (!isOnScreen()) return;
    const suggestion = (e as CustomEvent<string>).detail;
    if (typeof suggestion !== "string" || !suggestion) return;
    run((ctx) => showGhostSuggestion(ctx.get(editorViewCtx), suggestion));
  });

  // The tutorial's grammar step: underline a PRE-WRITTEN issue in the
  // practice paragraph (same no-backend reasoning as the ghost event above).
  // The issue offsets arrive relative to the practice sentence; re-base them
  // onto the cursor's paragraph, which may hold earlier text too.
  useWindowEvent(TUTORIAL_MOCK_GRAMMAR_EVENT, (e) => {
    if (!isOnScreen()) return;
    const detail = (e as CustomEvent<TutorialGrammarMock>).detail;
    if (!detail || !Array.isArray(detail.issues) || detail.issues.length === 0)
      return;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const para = view.state.selection.$from.parent;
      showGrammarIssues(view, anchorGrammarIssues(para.textContent, detail));
    });
  });

  // Clipboard-history panel clicks: carries the text as CustomEvent detail.
  useWindowEvent(INSERT_CLIPBOARD_TEXT_EVENT, (e) => {
    if (!isOnScreen()) return;
    const text = (e as CustomEvent<string>).detail;
    if (typeof text === "string" && text) insertText(text);
  });

  // Native Format menu clicks (see menu-insert-block in src-tauri/src/lib.rs,
  // relayed through App.tsx): same commands the right-click Insert submenu
  // below uses, keyed by the menu item's kind string instead of a click.
  useWindowEvent(INSERT_BLOCK_EVENT, (e) => {
    if (!isOnScreen()) return;
    const kind = (e as CustomEvent<string>).detail;
    const headingMatch = /^h([1-6])$/.exec(kind);
    if (headingMatch) {
      insertHeading(Number(headingMatch[1]));
      return;
    }
    switch (kind) {
      case "bullet-list":
        runCommand(wrapInBulletListCommand.key);
        break;
      case "ordered-list":
        runCommand(wrapInOrderedListCommand.key);
        break;
      case "blockquote":
        runCommand(wrapInBlockquoteCommand.key);
        break;
      case "code-block":
        runCommand(createCodeBlockCommand.key);
        break;
      case "table":
        setTableDialogOpen(true);
        break;
    }
  });

  // Chat-history panel clicks: load the saved conversation as the live one
  // and open Quick Ask to show it - its one-line summary picks up the last
  // reply; "open full conversation" (detach) reveals the rest on demand.
  useWindowEvent(RESTORE_CHAT_EVENT, (e) => {
    if (!isOnScreen()) return;
    const entry = (e as CustomEvent<ChatHistoryEntry>).detail;
    if (!entry || !Array.isArray(entry.turns)) return;
    conversation.restore(entry);
    inlineChat.open();
  });

  function runTableCommand(
    command: (
      state: EditorState,
      dispatch: (tr: Transaction) => void,
    ) => boolean,
  ) {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      command(view.state, view.dispatch);
      view.focus();
    });
  }

  // Grows the selection to the whole row/column of the current cell - both
  // as its own menu action and as the first step of column alignment.
  function selectTableLine(kind: "row" | "column") {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const $cell = selectionCell(view.state);
      if (!$cell) return;
      const selection =
        kind === "row"
          ? CellSelection.rowSelection($cell)
          : CellSelection.colSelection($cell);
      view.dispatch(view.state.tr.setSelection(selection));
      view.focus();
    });
  }

  // Markdown table alignment is a per-COLUMN property (the `:---:` marker
  // row), so aligning just the clicked cell serialized to something other
  // than what the editor showed - align the whole column instead.
  function alignTableColumn(alignment: "left" | "center" | "right") {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const $cell = selectionCell(view.state);
      if (!$cell) return;
      view.dispatch(
        view.state.tr.setSelection(CellSelection.colSelection($cell)),
      );
      setCellAttr("alignment", alignment)(view.state, view.dispatch);
      view.focus();
    });
  }

  // CmdKey<any>: the preset command keys vary in payload type (some
  // unknown, some undefined) and all are called here without a payload.
  function runCommand(key: CmdKey<any>) {
    run((ctx) => {
      ctx.get(commandsCtx).call(key);
      ctx.get(editorViewCtx).focus();
    });
  }

  function insertTable(rows: number, cols: number) {
    run((ctx) => {
      ctx
        .get(commandsCtx)
        .call(insertTableCommand.key, { row: rows, col: cols });
    });
  }

  function insertHeading(level: number) {
    run((ctx) => {
      ctx.get(commandsCtx).call(wrapInHeadingCommand.key, level);
      ctx.get(editorViewCtx).focus();
    });
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    // macOS WebKit selects the word under the pointer while handling a right
    // click in editable content - inside the engine, before any DOM event,
    // so it can't be prevented. But by the time contextmenu fires, only the
    // DOM selection has moved; ProseMirror's state still holds the real
    // selection (its readback is async). Pushing the state's selection back
    // into the DOM here undoes the word-select before it's ever painted or
    // read back, so AI context capture and the completion cursor never see it.
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { anchor, head } = view.state.selection;
      try {
        const a = view.domAtPos(anchor);
        const h = view.domAtPos(head);
        window
          .getSelection()
          ?.setBaseAndExtent(a.node, a.offset, h.node, h.offset);
      } catch {
        // Selection not representable in the DOM right now - leave it alone.
      }
    });
    setMenu({ x: e.clientX, y: e.clientY });
  }

  function buildMenuItems(): (ContextMenuItem | "separator")[] {
    // Each AI item is only offered while its feature is enabled in Settings.
    // The provider-free newcomer guide always exposes Ask AI so its real
    // right-click entry point remains available even if the user previously
    // disabled Agent chat before replaying the guide from Help.
    const aiItems: ContextMenuItem[] = [
      ...(settings.enableAskAi || tutorialMock
        ? [{ label: t.askAi, onSelect: openNewAgentConversation }]
        : []),
      ...(settings.enableCompletion
        ? [{ label: t.triggerCompletion, onSelect: triggerCompletion }]
        : []),
      ...(settings.enableGrammarCheck
        ? [{ label: t.triggerGrammarCheck, onSelect: triggerGrammarCheck }]
        : []),
    ];

    const clipboardItems: (ContextMenuItem | "separator")[] = [
      { label: t.cut, onSelect: () => copyOrCut(true) },
      { label: t.copy, onSelect: () => copyOrCut(false) },
      { label: t.paste, onSelect: paste },
      { label: t.selectAll, onSelect: selectAll },
      "separator",
      { label: t.findReplace, onSelect: findReplace.toggle },
      ...(aiItems.length > 0
        ? (["separator", ...aiItems] as (ContextMenuItem | "separator")[])
        : []),
    ];

    const insertItems: (ContextMenuItem | "separator")[] = [
      {
        label: t.insertBulletList,
        onSelect: () => runCommand(wrapInBulletListCommand.key),
      },
      {
        label: t.insertOrderedList,
        onSelect: () => runCommand(wrapInOrderedListCommand.key),
      },
      {
        label: t.insertBlockquote,
        onSelect: () => runCommand(wrapInBlockquoteCommand.key),
      },
      {
        label: t.insertCodeBlock,
        onSelect: () => runCommand(createCodeBlockCommand.key),
      },
      { label: t.insertTable, onSelect: () => setTableDialogOpen(true) },
    ];

    const inTable =
      run((ctx) => isInTable(ctx.get(editorViewCtx).state)) ?? false;
    if (!inTable) {
      return [...clipboardItems, "separator", ...insertItems];
    }

    return [
      ...clipboardItems,
      "separator",
      { label: t.alignLeft, onSelect: () => alignTableColumn("left") },
      { label: t.alignCenter, onSelect: () => alignTableColumn("center") },
      { label: t.alignRight, onSelect: () => alignTableColumn("right") },
      "separator",
      { label: t.selectRow, onSelect: () => selectTableLine("row") },
      { label: t.selectColumn, onSelect: () => selectTableLine("column") },
      "separator",
      {
        label: t.insertRowAbove,
        onSelect: () => runTableCommand(addRowBefore),
      },
      { label: t.insertRowBelow, onSelect: () => runTableCommand(addRowAfter) },
      {
        label: t.insertColumnLeft,
        onSelect: () => runTableCommand(addColumnBefore),
      },
      {
        label: t.insertColumnRight,
        onSelect: () => runTableCommand(addColumnAfter),
      },
      "separator",
      {
        label: t.deleteRow,
        onSelect: () => runTableCommand(deleteRow),
        danger: true,
      },
      {
        label: t.deleteColumn,
        onSelect: () => runTableCommand(deleteColumn),
        danger: true,
      },
      {
        label: t.deleteTable,
        onSelect: () => runTableCommand(deleteTable),
        danger: true,
      },
    ];
  }

  return (
    <div
      onContextMenu={onContextMenu}
      onMouseOver={grammar.onMouseOver}
      onMouseOut={grammar.onMouseOut}
    >
      <Milkdown />
      {findReplace.open && (
        <FindReplaceBar findReplace={findReplace} labels={t} />
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems()}
          onClose={() => setMenu(null)}
        />
      )}
      {aiNotice && (
        <div className="ai-notice floating-surface" role="status">
          {aiNotice}
        </div>
      )}
      {tableDialogOpen && (
        <InsertTableDialog
          title={t.insertTable}
          rowsLabel={t.insertTableRowsLabel}
          columnsLabel={t.insertTableColumnsLabel}
          confirmLabel={t.insertTableConfirm}
          cancelLabel={t.closePromptCancel}
          onInsert={insertTable}
          onClose={() => setTableDialogOpen(false)}
        />
      )}
      {grammar.popover && (
        <GrammarPopover
          info={grammar.popover}
          applyLabel={t.grammarApply}
          error={grammar.applyError}
          onApply={grammar.applyFix}
          onMouseEnter={grammar.cancelHide}
          onMouseLeave={grammar.hide}
        />
      )}
      {inlineChat.chatInfo &&
        inlineChat.visible &&
        quickAskEl &&
        // The panel renders through a portal into the zone widget's DOM
        // container (quick-ask-widget-plugin) - a real block in the
        // document flow, so it pushes content below it down instead of
        // floating over it.
        createPortal(
          <InlineChat
            document={inlineChat.chatInfo.document}
            selectedText={inlineChat.chatInfo.selectedText}
            selectionMarkdown={inlineChat.chatInfo.selectionMarkdown}
            docPath={filePath}
            workspaceRoot={settings.agentWorkspaceRoot || null}
            conversation={conversation}
            tutorialMock={tutorialMock}
            labels={chatLabels(t)}
            onProposals={showProposals}
            proposalStatus={pendingEdits.status}
            onAcceptProposal={pendingEdits.accept}
            onRejectProposal={pendingEdits.reject}
            onAcceptAll={pendingEdits.acceptAll}
            onRejectAll={pendingEdits.rejectAll}
            pendingCount={pendingEdits.decidable.length}
            focusIndex={pendingEdits.focusIndex}
            onFocusNext={handleFocusNext}
            onFocusPrevious={handleFocusPrevious}
            onAcceptFocused={handleAcceptFocused}
            onRejectFocused={handleRejectFocused}
            onDetach={handleDetachChat}
            onClose={inlineChat.close}
          />,
          quickAskEl,
        )}
    </div>
  );
}
