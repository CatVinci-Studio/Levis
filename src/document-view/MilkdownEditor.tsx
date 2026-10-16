import {
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import {
  orderedListAttr,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
} from "@milkdown/kit/preset/commonmark";
import { undoCommand, redoCommand } from "@milkdown/kit/plugin/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { listenerCtx } from "@milkdown/kit/plugin/listener";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { registerEditorFlush } from "../editor/editor-flush";
import {
  buildContextMenuItems,
  buildPhoneMoreItems,
  contextMenuTarget,
  deleteImage,
  insertHeading,
  insertTable,
  runCommand,
  runTableAction,
  selectedImagePos,
  setImageWidth,
} from "../editor/editor-menu";
import { toggleSpan } from "../editor/marks/span-commands";
import {
  cycleHeading,
  toggleBlockquote,
  toggleList,
} from "../editor/keys/block-toggles";
import {
  withEditorExtensions,
  type PendingEditCallbacks,
} from "./editor-extensions";
import { GrammarSuggestion } from "../ai/writing/GrammarSuggestion";
import { InlineChat } from "../ai/chat/quick-ask/InlineChat";
import { ChatBody } from "../ai/chat/ChatBody";
import { AgentPanelView } from "../ai/chat/panel/AgentPanelView";
import { CloseConfirmBar } from "../ai/chat/CloseConfirm";
import { ProjectBar } from "../ai/chat/panel/ProjectBar";
import { useAgentPanel } from "../ai/chat/panel/agent-panel";
import {
  cachedDocumentMarkdown,
  caretContext,
  headingAt,
  readSelection,
} from "../ai/doc-markdown";
import { chatLabels } from "../ai/chat/chat-labels";
import { useDetachedChat } from "../ai/chat/window/useDetachedChat";
import { canDetachChat, isIOSApp } from "../platform/capabilities";
import {
  editorFocusedBeforeAction,
  PRESS_WINDOW_MS,
  refocusAfterReview,
} from "../editor/review-focus";
import { readChatContext } from "../ai/chat/live-context";
import { ContextMenu } from "../editor/ContextMenu";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import { InsertTableDialog } from "../editor/tables/InsertTableDialog";
import { ImageNameDialog } from "../editor/images/ImageNameDialog";
import { useImageNameRequest } from "../editor/images/useImageNameRequest";
import { FindReplaceBar } from "../editor/find/FindReplaceBar";
import { useFindReplace } from "../editor/find/useFindReplace";
import { Presence, PresenceDiv } from "../ui/usePresence";
import { SparkleIcon } from "../ui/icons";
import { revealPosition } from "../editor/reveal-position";
import { useModeSwitchCaret } from "../editor/modes/useModeSwitchCaret";
import { useFocusModeRefresh } from "../editor/modes/useFocusModeRefresh";
import { useEditorRunner } from "../editor/useEditorRunner";
import { useEditorClipboard } from "../editor/useEditorClipboard";
import { useAiActions } from "../ai/writing/useAiActions";
import { useAgentConversation } from "../ai/chat/useAgentConversation";
import {
  blockPositionAfter,
  useInlineChat,
} from "../ai/chat/quick-ask/useInlineChat";
import { setChatSelection } from "../ai/chat/quick-ask/chat-selection-plugin";
import { setQuickAskWidget } from "../ai/chat/quick-ask/quick-ask-widget-plugin";
import { keepClearOfDock } from "../ai/chat/quick-ask/quick-ask-dock";
import {
  usePendingEdits,
  type SelectionTarget,
} from "../ai/revision/usePendingEdits";
import {
  pendingEditKey,
  prefersReducedMotion,
  streamPendingInsertText,
  type PendingPreview,
} from "../ai/revision/pending-edit-plugin";
import { ProposalStream } from "../ai/revision/proposal-stream";
import { ReviewBar } from "../ai/revision/ReviewBar";
import {
  effectiveRevisionDisplay,
  revisionDisplayName,
} from "../ai/revision/revision-display";
import { ReviewMargin } from "../ai/margin/ReviewMargin";
import { OpenReviewNote } from "../ai/margin/OpenReviewNote";
import { useReviewNotes } from "../ai/margin/useReviewNotes";
import type { ReviewNote } from "../ai/margin/review-notes-plugin";
import { isRefusal } from "../ai/revision/proposal-status";
import type { StreamEvent } from "../platform/ipc";
import { useGrammarPopover } from "../ai/writing/useGrammarPopover";
import { useSettings } from "../settings/SettingsContext";
import { useLatest } from "../utils/hooks/useLatest";
import { useWindowEvent } from "../utils/hooks/useWindowEvent";
import { normalizeMathDelimiters } from "../utils/markdown-math";
import { createTutorialMockAgent } from "../onboarding/tutorial-mock-agent";
import {
  TRIGGER_COMPLETION_EVENT,
  TRIGGER_GRAMMAR_CHECK_EVENT,
  TOGGLE_FLOATING_CHAT_EVENT,
  TOGGLE_FIND_REPLACE_EVENT,
  CLOSE_FIND_REPLACE_EVENT,
  INSERT_CLIPBOARD_TEXT_EVENT,
  RESTORE_CHAT_EVENT,
  INSERT_BLOCK_EVENT,
  TOGGLE_BLOCK_EVENT,
  TOGGLE_MARK_EVENT,
  TABLE_ACTION_EVENT,
  IMAGE_ACTION_EVENT,
  EDITOR_MORE_EVENT,
  EDIT_ACTION_EVENT,
  TUTORIAL_MOCK_GHOST_EVENT,
  TUTORIAL_MOCK_GRAMMAR_EVENT,
} from "../utils/events";
import { showGhostSuggestion } from "../ai/writing/ghost-text-plugin";
import { showGrammarIssues } from "../ai/writing/grammar-check-plugin";
import {
  anchorGrammarIssues,
  type TutorialGrammarMock,
} from "../onboarding/tutorial-evaluation";
import type { ChatHistoryEntry } from "../ai/chat/chat-history";
import type { EditProposal } from "../ai/types";
import { Milkdown, useEditor } from "@milkdown/react";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "katex/dist/katex.min.css";
import "../theme/content-base.css";
import "../editor/milkdown-theme.css";
import "../theme/content-themes.css";

interface MilkdownEditorProps {
  /** The owning tab - the key App.tsx flushes this editor under (see
   *  editor-flush.ts). */
  tabId: string;
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

/** Whether document position `pos` shows inside its editor's scroller. */
function previewOnScreen(view: EditorView, pos: number): boolean {
  const scroller = view.dom.closest(".editor-scroll");
  if (!scroller) return false;
  try {
    const at = view.coordsAtPos(Math.min(pos + 1, view.state.doc.content.size));
    const box = scroller.getBoundingClientRect();
    return at.top >= box.top && at.bottom <= box.bottom;
  } catch {
    return false;
  }
}

export function MilkdownEditor({
  tabId,
  filePath,
  docTitle,
  initialValue,
  onChange,
  isActive = true,
  tutorialMock = false,
}: MilkdownEditorProps) {
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    imagePos: number | null;
    /** Opened by the iPhone keyboard toolbar's "More": the phone's items
     *  (buildPhoneMoreItems), as an action sheet. */
    phone?: boolean;
  } | null>(null);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const { imageNameRequest, requestImageName, closeImageNameDialog } =
    useImageNameRequest();
  // The Quick Ask zone widget's DOM container (quick-ask-widget-plugin) -
  // null whenever no widget is in the document. InlineChat portals into it,
  // so the panel's actual pixels sit wherever ProseMirror placed the
  // decoration (in the document flow, pushing content below it down).
  const [quickAskEl, setQuickAskEl] = useState<HTMLElement | null>(null);
  // iPhone: Quick Ask docks at the bottom of the screen instead.
  const phone = usePhoneLayout();
  const { t, settings, setSettings } = useSettings();

  // The editor plugin chain below is only built once (empty deps), so
  // plugins read this ref to see live settings instead of the value
  // captured at construction time.
  const settingsRef = useLatest(settings);
  const filePathRef = useLatest(filePath);
  const docTitleRef = useLatest(docTitle);
  const isActiveRef = useLatest(isActive);
  const tutorialMockRef = useLatest(tutorialMock);
  const tRef = useLatest(t);
  const onChangeRef = useLatest(onChange);
  // The doc and markdown last handed to onChange (or the mount-time doc),
  // for flushing an edit the listener's debounce still holds - see
  // editor-flush.ts.
  const reportedDocRef = useRef<ProseNode | null>(null);
  const reportedMarkdownRef = useRef<string | null>(null);
  // The file as it was opened, and what the editor would write for the doc
  // it parsed that into (computed the first time it is needed). A change
  // that serializes back to that same text - a plugin touching node attrs
  // on mount, an edit undone - is not an edit: the tab reports the file's
  // own text, so it stays clean and a save leaves the file byte-for-byte
  // as it was instead of rewriting it in the serializer's house style.
  const openedValueRef = useRef(initialValue);
  const mountDocRef = useRef<ProseNode | null>(null);
  const mountMarkdownRef = useRef<string | null>(null);
  const reportMarkdown = useCallback(
    (ctx: Ctx, markdown: string) => {
      const mountDoc = mountDocRef.current;
      if (mountDoc && mountMarkdownRef.current === null)
        mountMarkdownRef.current = ctx.get(serializerCtx)(mountDoc);
      const value =
        markdown === mountMarkdownRef.current
          ? openedValueRef.current
          : markdown;
      reportedMarkdownRef.current = value;
      onChangeRef.current(value);
    },
    [onChangeRef],
  );

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
    onDecide: () => {},
    getFocusedSentence: () => null,
  });
  // Same bridge, for the selection listener registered in the chain below:
  // the real handler needs `run` and the detached-chat bridge, neither of
  // which exists yet at construction time.
  const onSelectionChangeRef = useRef<() => void>(() => {});
  // Whether a rewrite's replacements are drawn in the text (no margin) -
  // ReviewMargin decides, the pending-edit plugin reads it.
  const noMarginRef = useRef(false);
  // The review notes' plugin callbacks, bridged like the pending edits'.
  const reviewNotesRef = useRef<{
    onChange: (notes: ReviewNote[]) => void;
    onBadge: (id: string, el: HTMLElement) => void;
  }>({ onChange: () => {}, onBadge: () => {} });
  // Defined further down (useGrammarPopover); read through a ref here.
  const grammarCaretRef = useRef<() => void>(() => {});

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
          // A list starting somewhere other than 1 ("3. ") is the one thing
          // the DOM structure alone doesn't tell the counter that numbers
          // ordered lists (see .milkdown ol in milkdown-theme.css), so the
          // node's `order` rides along as a custom property. Minus one
          // because counter-reset sets the value BEFORE the first increment.
          ctx.set(orderedListAttr.key, (node) => {
            const order = (node.attrs.order as number) ?? 1;
            return order === 1
              ? {}
              : { style: `--textus-ol-start: ${order - 1}` };
          });
          ctx
            .get(listenerCtx)
            .mounted((ctx) => {
              const { doc } = ctx.get(editorViewCtx).state;
              reportedDocRef.current = doc;
              mountDocRef.current = doc;
            })
            // Fires just before markdownUpdated, from the same debounce.
            .updated((_ctx, doc) => {
              reportedDocRef.current = doc;
            })
            .markdownUpdated((ctx, markdown) => {
              reportMarkdown(ctx, markdown);
            })
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
          onPreviewsChange: (previews, applied) =>
            pendingEditActionsRef.current.onPreviewsChange(previews, applied),
          getFocusedCallId: () =>
            pendingEditActionsRef.current.getFocusedCallId(),
          onDecide: (callId, index, take) =>
            pendingEditActionsRef.current.onDecide(callId, index, take),
          getFocusedSentence: () =>
            pendingEditActionsRef.current.getFocusedSentence(),
          revisionDisplay: () =>
            effectiveRevisionDisplay(
              settingsRef.current.revisionDisplay,
              !noMarginRef.current,
            ),
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
        requestImageName,
        {
          onChange: (notes) => reviewNotesRef.current.onChange(notes),
          onBadge: (id, el) => reviewNotesRef.current.onBadge(id, el),
        },
      ),
    [],
  );

  const run = useEditorRunner();
  const { copyOrCut, paste, selectAll, insertText } = useEditorClipboard(run);

  // The listener's debounce reports the same doc again later - a harmless
  // repeat of the markdown already handed over here.
  useEffect(
    () =>
      registerEditorFlush(
        tabId,
        () =>
          run((ctx) => {
            const { doc } = ctx.get(editorViewCtx).state;
            const reported = reportedDocRef.current;
            if (reported && !doc.eq(reported)) {
              reportedDocRef.current = doc;
              reportMarkdown(ctx, ctx.get(serializerCtx)(doc));
            }
            return reportedMarkdownRef.current;
          }) ?? null,
      ),
    [tabId, run, reportMarkdown],
  );

  // Transient, self-dismissing notice for on-demand AI triggers ("no issues
  // found", "not signed in", ...) - deliberately not a native alert():
  // those block the whole webview (and freeze automation) over messages
  // that are often benign.
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  // When it goes, so a pointer resting on it can hold it (and give back
  // what was left of its time when it moves off).
  const noticeDeadline = useRef(0);
  const showAiNotice = useCallback((message: string | null) => {
    setAiNotice(message);
    window.clearTimeout(noticeTimer.current);
    if (!message) return;
    noticeDeadline.current = Date.now() + 4000;
    noticeTimer.current = window.setTimeout(() => setAiNotice(null), 4000);
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  const holdAiNotice = () => window.clearTimeout(noticeTimer.current);
  const releaseAiNotice = () => {
    const left = Math.max(1500, noticeDeadline.current - Date.now());
    noticeDeadline.current = Date.now() + left;
    noticeTimer.current = window.setTimeout(() => setAiNotice(null), left);
  };

  const { triggerCompletion, triggerGrammarCheck } = useAiActions(
    run,
    () => settingsRef.current,
    () => tRef.current,
    showAiNotice,
    () => filePathRef.current,
  );
  const inlineChat = useInlineChat(run);
  // Keep the text the chat was opened over visibly marked for as long as
  // the chat context lives (popup or detached window) - the native
  // selection paint is gone the moment the composer takes focus.
  // Only while the panel showing it is on screen: a detached or hidden
  // Quick Ask left its old range highlighted while the window was talking
  // about a different passage.
  const chatRange = inlineChat.visible
    ? (inlineChat.chatInfo?.range ?? null)
    : null;
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(setChatSelection(view.state.tr, chatRange));
    });
  }, [chatRange, run]);
  // The empty-document placeholder reads the language when it draws, and
  // decorations only draw on a transaction: without one, switching the
  // language in Settings (or on the first-run picker) left the old text.
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta("addToHistory", false));
    });
  }, [settings.language, run]);
  // Shows/hides the Quick Ask zone widget. Keyed on `visible` alone (NOT
  // chatInfo.widgetPos) - once shown, the plugin remaps the widget's
  // position through edits on its own; re-running this on every chatInfo
  // change would snap it back to the position captured at open time and
  // undo that tracking. `visible` transitioning true is exactly "just
  // opened (or reopened)", which is the only moment a fresh position makes
  // sense - `open()` always sets both chatInfo and visible together.
  // On a phone there is no widget at all: the panel docks above the
  // keyboard instead (InlineChat's `docked`), since a block in the
  // document ends up under the keyboard with no way to scroll to it.
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(
        setQuickAskWidget(
          view.state.tr,
          inlineChat.visible && !phone
            ? (inlineChat.chatInfo?.widgetPos ?? null)
            : null,
        ),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineChat.visible, phone, run]);
  const pendingEdits = usePendingEdits(run);
  useEffect(() => {
    pendingEditActionsRef.current = {
      onAccept: pendingEdits.accept,
      onReject: pendingEdits.reject,
      onPreviewsChange: pendingEdits.syncFromPlugin,
      getFocusedCallId: () => pendingEdits.focusedPreview?.callId ?? null,
      onDecide: pendingEdits.decide,
      getFocusedSentence: () => pendingEdits.focusedStop,
    };
  }, [
    pendingEdits.accept,
    pendingEdits.reject,
    pendingEdits.syncFromPlugin,
    pendingEdits.focusedPreview,
    pendingEdits.decide,
    pendingEdits.focusedStop,
  ]);
  // Switching how revisions show (Settings, or the review bar's menu)
  // redraws them.
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta(pendingEditKey, { type: "refocus" }));
    });
  }, [settings.revisionDisplay, run]);
  // The review bar's pointer is drawn in the text (an outline round the
  // sentence): redraw when it moves.
  const focusedStopKey = pendingEdits.focusedStop
    ? `${pendingEdits.focusedStop.callId}:${pendingEdits.focusedStop.index}`
    : null;
  useEffect(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta(pendingEditKey, { type: "refocus" }));
    });
  }, [focusedStopKey, run]);
  // Re-prompting supersedes: the first proposal a new exchange writes into
  // the document clears whatever previews the user left undecided - the new
  // suggestion replaces the old one on screen instead of stacking under it.
  // Armed when an exchange starts (the busy effect below for the embedded
  // bar; onContextRequest for detached sends), consumed by the first preview
  // add that follows - so a question exchange that proposes nothing leaves
  // existing previews alone, and later proposals of the SAME exchange
  // coexist as siblings. The superseded proposals read as "rejected"
  // everywhere downstream (chat cards, next request's status notes).
  const supersedePending = useRef(false);
  // What a replace_selection proposal from the editor's own conversation
  // targets: recorded by whichever surface SENDS (Quick Ask's captured
  // selection, or the panel's live selection at send time), so a selection
  // made while the reply is still streaming can't redirect it.
  const requestTargetRef = useRef<SelectionTarget | null>(null);
  // The same, for a request from the detached window: the selection it was
  // shown when it asked for context, not whatever has been pushed since.
  const detachedTargetRef = useRef<SelectionTarget | null>(null);
  const addPreviews = useCallback(
    (
      proposals: {
        callId: string;
        proposal: EditProposal;
        streaming?: boolean;
      }[],
      target: SelectionTarget | null,
    ) => {
      if (supersedePending.current) {
        supersedePending.current = false;
        pendingEdits.rejectAll();
      }
      pendingEdits.showPreviews(proposals, target);
    },
    // Member functions only - both are stable per editor ([run]), and
    // depending on the whole `pendingEdits` object (fresh every render)
    // would destabilize the ProposalStream memo below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingEdits.rejectAll, pendingEdits.showPreviews],
  );
  // A streaming propose_edit grows its green preview in the document while
  // the model is still writing it. All lifecycle decisions - when a draft is
  // placed, what a stop keeps, what a failure discards - live in the
  // ProposalStream machine (proposal-stream.ts); this component only wires
  // its effects to the editor. Gated on the animation setting: off means
  // previews appear complete, at once.
  // propose_edit call ids awaiting their tool result, and what a refused
  // one does: the preview goes (reject is stable per editor; the model
  // never hears this status - annotateProposalStatuses skips refusals).
  const proposalCallIds = useRef(new Set<string>());
  const discardRefused = pendingEdits.reject;
  const proposalStream = useMemo(
    () =>
      new ProposalStream({
        place: (callId, proposal) =>
          addPreviews(
            [{ callId, proposal, streaming: true }],
            requestTargetRef.current,
          ),
        feed: streamPendingInsertText,
        finalize: (callId, proposal) =>
          addPreviews([{ callId, proposal }], requestTargetRef.current),
        discard: pendingEdits.reject,
      }),
    // requestTargetRef is a stable ref; addPreviews/reject are stable per
    // editor (useCallback on `run`).
    [addPreviews, pendingEdits.reject],
  );
  const handleStreamEvent = useCallback(
    (event: StreamEvent) => {
      // A propose_edit the backend refused (tools.rs: a cut-off `text`)
      // may already be on screen - streamed, or placed from its call turn
      // a moment before this result arrived. The model resends it; this
      // copy must go, with or without animation.
      if (
        event.type === "turn" &&
        event.turn.kind === "ToolCall" &&
        event.turn.name === "propose_edit"
      )
        proposalCallIds.current.add(event.turn.call_id);
      if (
        event.type === "turn" &&
        event.turn.kind === "ToolResult" &&
        proposalCallIds.current.has(event.turn.call_id)
      ) {
        proposalCallIds.current.delete(event.turn.call_id);
        if (isRefusal(event.turn.output)) discardRefused(event.turn.call_id);
        return;
      }
      // Reduced motion renders widgets instantly, so streamed drafts would
      // create animation entries nothing ever reveals (or settles).
      if (!settingsRef.current.enableEditAnimation || prefersReducedMotion())
        return;
      if (event.type === "toolStart")
        proposalStream.toolStart(event.callId, event.name);
      else if (event.type === "toolArgsDelta")
        proposalStream.argsDelta(event.callId, event.delta);
      else if (
        event.type === "turn" &&
        event.turn.kind === "ToolCall" &&
        event.turn.name === "propose_edit"
      )
        proposalStream.finalCall(event.turn.call_id, event.turn.arguments);
    },
    // settingsRef is a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proposalStream, discardRefused],
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
    pendingEdits.allStatuses,
  );
  // Quick Ask's own conversation: a one-off exchange at the caret, kept out
  // of the History list. "Continue in the panel" hands it to `conversation`
  // (expandQuickAsk), which is the one the panel, the detached window and
  // History share.
  const quickConversation = useAgentConversation(
    filePath,
    settings.agentWorkspaceRoot || null,
    settings.aiProvider,
    settings.enableWebSearch,
    agentModel,
    tutorialMock ? createTutorialMockAgent(t) : null,
    handleStreamEvent,
    pendingEdits.allStatuses,
    false,
  );
  // Exchange boundaries. Start (busy rising): arm the supersede flag so this
  // exchange's first proposal clears the undecided leftovers of the previous
  // one. End with drafts still open: a user stop keeps what was already
  // typed into the document (frozen as a decidable preview), a failure
  // discards it - Retry would otherwise duplicate the proposal. A normal
  // completion left the machine empty and finish is a no-op.
  useEffect(() => {
    if (conversation.busy) {
      supersedePending.current = true;
      return;
    }
    proposalStream.finish(conversation.error ? "failed" : "stopped");
  }, [conversation.busy, conversation.error, proposalStream]);
  useEffect(() => {
    if (quickConversation.busy) {
      supersedePending.current = true;
      return;
    }
    proposalStream.finish(quickConversation.error ? "failed" : "stopped");
  }, [quickConversation.busy, quickConversation.error, proposalStream]);
  // Proposals always resolve HERE, whether the chat that produced them is
  // the embedded popup or a detached window - one implementation of the
  // anchor/apply logic, addressed two ways (see chat-bridge.ts).
  const showProposals = useCallback(
    (proposals: { callId: string; proposal: EditProposal }[]) => {
      addPreviews(proposals, requestTargetRef.current);
    },
    [addPreviews],
  );

  // Quick Ask sends against the selection it captured when it opened.
  const quickSendContext = useCallback(async () => {
    const sent = await inlineChat.sendContext();
    if (sent) {
      requestTargetRef.current = {
        range: sent.range,
        selectionMarkdown: sent.selectionMarkdown,
        cursor: sent.cursor?.pos ?? null,
      };
    }
    return sent;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineChat.sendContext]);

  // The docked panel sends against the document and selection as they read
  // at the moment of sending - it follows the user's work, like the
  // detached window, but reads its own editor directly.
  const panelSendContext = useCallback(
    async () =>
      run((ctx) => {
        const { state } = ctx.get(editorViewCtx);
        const selection = readSelection(ctx, state);
        const caret = caretContext(state);
        requestTargetRef.current = {
          range: selection.range,
          selectionMarkdown: selection.selectionMarkdown,
          cursor: caret?.pos ?? null,
        };
        return {
          document: cachedDocumentMarkdown(ctx, state.doc),
          selectionMarkdown: selection.selectionMarkdown,
          cursor: caret,
          focusHeading: headingAt(state.doc, state.selection.from),
        };
      }) ?? null,
    [run],
  );

  // The selection this window last SENT to the detached chat. A
  // replace_selection proposal from that window has to resolve against it
  // and not against Quick Ask's: the tab the window is asking about may
  // never have opened Quick Ask at all, and the rewrite would then come
  // back un-appliable with nothing on screen explaining why.
  const sentSelection = useRef<SelectionTarget | null>(null);

  const detachedChat = useDetachedChat({
    // Every open tab in this window receives the chat's events, and with one
    // chat window serving several files they are NOT all for this tab.
    // Matching on the path the chat addressed is exact whenever the document
    // has one; an unsaved draft has no path to match, so the active tab (the
    // only one the chat could have been showing) stands in. The hook applies
    // this before dispatching any doc-scoped handler below, so none of them
    // can forget the check.
    isTarget: (docPath) =>
      docPath !== null ? docPath === filePathRef.current : isActiveRef.current,
    onProposals: (proposals) =>
      addPreviews(proposals, detachedTargetRef.current),
    onAccept: pendingEdits.accept,
    onReject: pendingEdits.reject,
    onAcceptAll: pendingEdits.acceptAll,
    onRejectAll: pendingEdits.rejectAll,
    // A send is about to go out and needs the document as it reads NOW - not
    // as it read when the selection last changed. Forced: the selection is
    // usually unchanged, but the document almost certainly isn't. The
    // request only ever precedes a send, so it doubles as the detached
    // window's exchange-start signal for the supersede flag - a detached
    // send runs in the chat window's own conversation and never flips this
    // editor's `conversation.busy` (whose rising edge arms the embedded
    // bar's sends, in the busy effect above).
    // Only the active tab answers: the request goes to every editor in the
    // window, and arming the others' supersede flag made their next proposal
    // silently clear previews that had nothing to do with this exchange.
    onContextRequest: () => {
      if (!isActiveRef.current) return;
      supersedePending.current = true;
      forcePushLiveContextRef.current();
      detachedTargetRef.current = sentSelection.current;
    },
    // The window handed its conversation back on close. Closing means
    // closing: the exchange quietly becomes this document's conversation
    // again (the panel shows it next time), instead of a Quick Ask bar
    // popping up - in every tab, as it used to.
    onReembed: (conversationId, turns, docPath) => {
      const mine =
        docPath !== null
          ? docPath === filePathRef.current
          : isActiveRef.current;
      if (mine && turns.length > 0) conversation.restore(conversationId, turns);
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
    // The guard runs BEFORE any serialization: selectionUpdated fires on
    // every transaction, so this path also runs per keystroke - and typing
    // replaces the doc, which is exactly when the document cache inside
    // readChatContext misses. The plain-text selection and the path are all
    // the guard needs, and both are cheap reads.
    const selection = run((ctx) => {
      const { state } = ctx.get(editorViewCtx);
      return state.selection.empty
        ? ""
        : state.doc.textBetween(state.selection.from, state.selection.to, " ");
    });
    if (
      selection === undefined ||
      (pushed.current?.selection === selection &&
        pushed.current.docPath === filePathRef.current)
    ) {
      return;
    }
    const live = readChatContext(
      run,
      filePathRef.current,
      docTitleRef.current,
      getCurrentWindow().label,
    );
    if (!live) return;
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

  // The docked panel (ai/chat/panel/agent-panel.tsx): rendered by THIS editor only
  // while it is the active tab and the panel is open.
  const agentPanel = useAgentPanel();
  const panelContainer = isActive ? agentPanel.container : null;
  const panelContainerRef = useLatest(panelContainer);
  // The live selection, for the panel's selection chip. Plain text and
  // bounds only - cheap enough per selection change; the markdown the
  // request carries is serialized once, at send (panelSendContext).
  const [panelSelection, setPanelSelection] = useState<{
    text: string;
    range: { from: number; to: number };
  } | null>(null);
  const updatePanelSelection = useCallback(() => {
    if (!panelContainerRef.current) return;
    const next = run((ctx) => {
      const { selection, doc } = ctx.get(editorViewCtx).state;
      return selection.empty
        ? null
        : {
            text: doc.textBetween(selection.from, selection.to, " "),
            range: { from: selection.from, to: selection.to },
          };
    });
    if (next === undefined) return;
    setPanelSelection((prev) =>
      prev?.range.from === next?.range.from && prev?.range.to === next?.range.to
        ? prev
        : next,
    );
    // run is stable; panelContainerRef is a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);
  useEffect(() => {
    if (panelContainer) updatePanelSelection();
  }, [panelContainer, updatePanelSelection]);

  // A new selection becomes a new chip in the detached window and the
  // panel - "re-drag to highlight and it goes in" is the behaviour that
  // separates those surfaces from the in-document Quick Ask bar.
  onSelectionChangeRef.current = () => {
    pushLiveContext();
    updatePanelSelection();
    grammarCaretRef.current();
  };

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

  /** iPad: whether the editor had focus at the last press anywhere in the
   *  page - see editorFocusedBeforeAction. */
  const focusAtPress = useRef<{ focused: boolean; at: number } | null>(null);
  const editorHasFocus = useCallback(
    () => run((ctx) => ctx.get(editorViewCtx).hasFocus()) === true,
    [run],
  );
  useEffect(() => {
    // The active tab's editor only: the others take no review steps.
    if (!isIOSApp || phone || !isActive) return;
    const record = () => {
      focusAtPress.current = { focused: editorHasFocus(), at: Date.now() };
    };
    // Capture, so it runs before the press can move the focus anywhere.
    window.addEventListener("pointerdown", record, true);
    return () => window.removeEventListener("pointerdown", record, true);
  }, [phone, isActive, editorHasFocus]);
  function editorHadFocusBeforeAction(): boolean {
    return editorFocusedBeforeAction(
      editorHasFocus(),
      focusAtPress.current,
      Date.now(),
    );
  }

  /** Scrolls to a pending edit and, while Quick Ask is the active surface,
   *  moves its zone widget to follow - the direct, synchronous result of a
   *  nav-bar click (Next/Previous/Accept/Reject), never a background
   *  reaction to something else changing (see the call sites below).
   *  `editorHadFocus`: whether the editor had focus when the step began
   *  (by default: now, or at the press that started it). */
  function revealPreview(
    preview: PendingPreview,
    editorHadFocus = editorHadFocusBeforeAction(),
    arriving = false,
  ) {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { doc } = view.state;
      // Edits arriving mid-answer, the first already on screen: the panel
      // stays where it is. Moved to the edit's block, it jumped from under
      // the selection to above it in one frame and pushed the text down.
      const stay = arriving && !phone && previewOnScreen(view, preview.from);
      // near(), not create(): an anchored proposal's `from` is the position
      // BEFORE a block node, which is not a valid text position - create()
      // throws there. near() snaps to the closest one it can select.
      let tr = view.state.tr.setSelection(
        TextSelection.near(doc.resolve(preview.from)),
      );
      if (!stay) tr = tr.scrollIntoView();
      if (inlineChat.visible && !phone && !stay) {
        tr = setQuickAskWidget(tr, blockPositionAfter(doc, preview.from));
      }
      view.dispatch(tr);
      // Docked on a phone, the panel covers the bottom of the scroll area
      // that scrollIntoView counted as visible.
      if (inlineChat.visible && phone) {
        requestAnimationFrame(() => keepClearOfDock(view, preview.from, true));
      }
      // Back into the document, except out of a text field, on a phone, or
      // on an iPad whose user wasn't typing in it (review-focus.ts).
      const active = document.activeElement;
      if (
        refocusAfterReview({
          phone,
          ios: isIOSApp,
          editorHadFocus,
          textFieldFocused:
            active instanceof HTMLTextAreaElement ||
            active instanceof HTMLInputElement,
        })
      )
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
  /** Whether the editor had focus when the Accept/Reject that armed the
   *  reveal was pressed - by the time the reveal runs, a render later, that
   *  is history - and when. Null when edits arriving armed it. */
  const revealArmedFocus = useRef<{ focused: boolean; at: number } | null>(
    null,
  );
  const hadPendingRef = useRef(false);
  useEffect(() => {
    const hasPending = pendingEdits.decidable.length > 0;
    if (hasPending && !hadPendingRef.current) {
      revealArmed.current = true;
      revealArmedFocus.current = null;
    }
    hadPendingRef.current = hasPending;
  }, [pendingEdits.decidable.length]);
  useEffect(() => {
    if (!revealArmed.current) return;
    revealArmed.current = false;
    const armed = revealArmedFocus.current;
    revealArmedFocus.current = null;
    if (pendingEdits.focusedPreview)
      revealPreview(
        pendingEdits.focusedPreview,
        // The press that armed it, if it was just now; otherwise (edits
        // arriving, or an arming that never led to a reveal until much
        // later) nobody pressed anything for this reveal - only whether
        // the editor has focus now counts.
        armed && Date.now() - armed.at < PRESS_WINDOW_MS
          ? armed.focused
          : editorHasFocus(),
        armed === null,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEdits.focusedPreview]);

  function armReveal() {
    revealArmed.current = true;
    revealArmedFocus.current = {
      focused: editorHadFocusBeforeAction(),
      at: Date.now(),
    };
  }

  function handleAcceptFocused() {
    armReveal();
    pendingEdits.acceptFocused();
  }

  function handleRejectFocused() {
    armReveal();
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
    void (async () => {
      try {
        await detachedChat.detach(
          {
            context: live.context,
            conversationId: conversation.conversationId,
            turns: conversation.history,
            statuses: pendingEdits.allStatuses,
          },
          t.chatWindowTitle,
          settings.pinAgentWindow,
        );
      } catch {
        // The window never opened. Keeping the bar is the point: hiding it
        // anyway would leave pending edits with no accept/reject surface at
        // all, which is only ever safe once the window that takes them over
        // actually exists.
        return;
      }
      // The Quick Ask bar gives way to the window; chatInfo stays set so
      // proposals arriving from the window still resolve against this
      // request's context.
      inlineChat.hide();
    })();
  }

  // What Ask AI means, from every entry point: Quick Ask opens at the caret,
  // whatever the panel or a detached window is doing - it has its own
  // conversation, so there is nothing to race. The shortcut additionally
  // closes a Quick Ask whose composer already has focus, so pressing it
  // twice is "open, then put away".
  // Closing, and starting a new conversation, are guarded: with edits still
  // undecided the panel asks first (CloseConfirmBar), from every entry point.
  const [chatGuard, setChatGuard] = useState<"close" | "new" | null>(null);

  // The question is moot once the panel is gone (detached, say) or its
  // edits are all decided some other way - in the document, for instance.
  const decidableCount = pendingEdits.decidable.length;
  useEffect(() => {
    if (!inlineChat.visible || decidableCount === 0) setChatGuard(null);
  }, [inlineChat.visible, decidableCount]);

  useModeSwitchCaret(run, isActive, initialValue);

  // Where the Quick Ask panel renders: the zone widget in the document, or
  // on a phone the page itself, docked - for the active tab only, since
  // the page is shared by every tab's editor.
  const quickAskHost = phone ? (isActive ? document.body : null) : quickAskEl;
  const chatComposer = () =>
    quickAskHost?.querySelector<HTMLTextAreaElement>(".inline-chat textarea") ??
    null;

  /** Docked Quick Ask: keeps what it is about - the edit under review, the
   *  first one proposed, else the passage it was opened on - above the
   *  panel as the panel opens and grows. */
  function keepQuickAskTargetInView(first: boolean) {
    const info = inlineChat.chatInfo;
    const target =
      (pendingEdits.focusedPreview ?? pendingEdits.decidable[0])?.from ??
      info?.range?.from ??
      info?.anchor;
    if (target === undefined) return;
    run((ctx) => keepClearOfDock(ctx.get(editorViewCtx), target, first));
  }

  function focusEditor() {
    run((ctx) => ctx.get(editorViewCtx).focus());
  }

  function performChatAction(action: "close" | "new") {
    setChatGuard(null);
    if (action === "close") {
      // Closing while a reply is still running stops it: otherwise previews
      // kept appearing in the document with no panel left to decide them.
      if (quickConversation.busy) quickConversation.stop();
      inlineChat.close();
      focusEditor();
    } else {
      quickConversation.reset();
      inlineChat.close();
      inlineChat.open();
    }
  }

  function requestChatAction(action: "close" | "new") {
    if (pendingEdits.decidable.length > 0) setChatGuard(action);
    else performChatAction(action);
  }

  function openAgentConversation() {
    const wasVisible = inlineChat.visible;
    // A fresh Quick Ask is a fresh question; an open one keeps its exchange.
    if (!wasVisible && !quickConversation.busy) quickConversation.reset();
    const moveTo = inlineChat.open();
    if (moveTo !== null && !phone) {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(setQuickAskWidget(view.state.tr, moveTo));
      });
    }
    if (wasVisible) chatComposer()?.focus();
  }

  function startNewAgentConversation() {
    requestChatAction("new");
  }

  function toggleAgentConversation() {
    const composer = chatComposer();
    if (inlineChat.visible && composer && document.activeElement === composer) {
      requestChatAction("close");
    } else {
      openAgentConversation();
    }
  }
  useFocusModeRefresh(run, isActive, settings.typewriterMode);
  const grammar = useGrammarPopover(run, () => t.grammarApplyStale);
  // A phone has no hover and no arrow keys - a tap on an underline is the
  // way in, so there the caret opens the suggestion only right after a
  // touch, not whenever typing happens to end against a flagged word (the
  // ranges include their edges). The listener reports the selection while
  // the transaction is still being applied, before the view holds it, so
  // the phone's check waits a frame to see where the tap put the caret.
  const lastTouchRef = useRef(0);
  const onGrammarCaret = grammar.onCaretMove;
  grammarCaretRef.current = () => {
    if (!phone) onGrammarCaret();
    else if (Date.now() - lastTouchRef.current < 800)
      requestAnimationFrame(onGrammarCaret);
  };
  const findReplace = useFindReplace(run);

  // Fixed-position popups are placed once, from where their anchor was:
  // when the page moves under them (scroll, resize, the window losing
  // focus) they'd point at the wrong text, so they close instead.
  // A phone shows both as action sheets, which point at nothing - and
  // closing them when the sheet's own list scrolls or the keyboard goes
  // down would only lose them.
  const hideGrammar = grammar.hide;
  const anyPopup = !phone && (menu !== null || grammar.popover !== null);
  useEffect(() => {
    if (!anyPopup) return;
    const close = () => {
      setMenu(null);
      hideGrammar();
    };
    // Typewriter mode scrolls on every caret move - the very move that
    // opens the grammar popover - so there a scroll only closes the menu.
    // A long menu scrolls inside itself (a table's, on a short window);
    // that moves nothing it points at, so it stays open.
    const onScroll = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(".floating-surface"))
        return;
      setMenu(null);
      if (!settingsRef.current.typewriterMode) hideGrammar();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [anyPopup, hideGrammar, settingsRef]);

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
      toggleAgentConversation(),
  );
  useWindowEvent(
    TOGGLE_FIND_REPLACE_EVENT,
    () => isOnScreen() && findReplace.toggle(),
  );
  useWindowEvent(CLOSE_FIND_REPLACE_EVENT, () => findReplace.dismiss());

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
      insertHeading(run, Number(headingMatch[1]));
      return;
    }
    switch (kind) {
      case "bullet-list":
        runCommand(run, wrapInBulletListCommand.key);
        break;
      case "ordered-list":
        runCommand(run, wrapInOrderedListCommand.key);
        break;
      case "blockquote":
        runCommand(run, wrapInBlockquoteCommand.key);
        break;
      case "code-block":
        runCommand(run, createCodeBlockCommand.key);
        break;
      case "table":
        setTableDialogOpen(true);
        break;
    }
  });

  // The iPhone keyboard toolbar's block buttons, which toggle (see
  // block-toggles.ts) rather than only insert.
  useWindowEvent(TOGGLE_BLOCK_EVENT, (e) => {
    if (!isOnScreen()) return;
    const kind = (e as CustomEvent<string>).detail;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (kind === "heading") cycleHeading(view);
      else if (kind === "bullet-list") toggleList(view, "bullet_list");
      else if (kind === "ordered-list") toggleList(view, "ordered_list");
      else if (kind === "blockquote") toggleBlockquote(view);
      view.focus();
    });
  });

  // The iPhone keyboard toolbar's bold and italic.
  useWindowEvent(TOGGLE_MARK_EVENT, (e) => {
    if (!isOnScreen()) return;
    const mark = (e as CustomEvent<string>).detail;
    if (mark !== "bold" && mark !== "italic") return;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      toggleSpan(view, mark === "bold" ? 2 : 1);
      view.focus();
    });
  });

  // The iPhone keyboard toolbar's table buttons: the right-click menu's
  // insert and delete items, for the table under the caret.
  useWindowEvent(TABLE_ACTION_EVENT, (e) => {
    if (!isOnScreen()) return;
    runTableAction(run, (e as CustomEvent<string>).detail);
  });

  // The iPhone keyboard toolbar's image buttons: the right-click menu's
  // width presets, and delete, for the image the selection is on.
  useWindowEvent(IMAGE_ACTION_EVENT, (e) => {
    if (!isOnScreen()) return;
    const pos = selectedImagePos(run);
    if (pos === null) return;
    const action = (e as CustomEvent<string>).detail;
    if (action === "delete") {
      deleteImage(run, pos);
      return;
    }
    const width = /^width:(auto|\d+)$/.exec(action)?.[1];
    // Still selected afterwards, so the toolbar shows the new width on and
    // another preset is a tap away.
    if (width)
      setImageWidth(run, pos, width === "auto" ? null : Number(width), true);
  });

  // The iPhone keyboard toolbar's "More": the editor's menu for where the
  // caret is, as an action sheet.
  useWindowEvent(EDITOR_MORE_EVENT, () => {
    if (!isOnScreen()) return;
    setMenu({ x: 0, y: 0, imagePos: selectedImagePos(run), phone: true });
  });

  // The app-drawn menu's Edit submenu (Windows - see app/app-menu-actions.ts).
  // These are `PredefinedMenuItem`s in the native menu, which gives them no
  // id to dispatch by, so they arrive as an event and run the very commands
  // the right-click menu below runs.
  useWindowEvent(EDIT_ACTION_EVENT, (e) => {
    if (!isOnScreen()) return;
    switch ((e as CustomEvent<string>).detail) {
      case "undo":
        runCommand(run, undoCommand.key);
        break;
      case "redo":
        runCommand(run, redoCommand.key);
        break;
      case "cut":
        copyOrCut(true);
        break;
      case "copy":
        copyOrCut(false);
        break;
      case "paste":
        paste();
        break;
      case "select-all":
        selectAll();
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
    conversation.restore(entry.id, entry.turns);
    // The full conversation belongs in the panel; Quick Ask only ever showed
    // its last line.
    agentPanel.setOpen(true);
  });

  // Quick Ask's "continue in the panel": its exchange becomes the full
  // conversation - in the docked panel, or the detached window when the
  // user prefers it there (Settings > Textus AI > Advanced) - and from then
  // on is saved to History like any other. The panel's previous
  // conversation is already in History. Not while either side is
  // mid-reply: the turns would be incomplete.
  function expandQuickAsk() {
    if (quickConversation.busy || conversation.busy) return;
    if (quickConversation.history.length > 0) {
      conversation.restore(crypto.randomUUID(), quickConversation.history);
    }
    quickConversation.reset();
    inlineChat.close();
    if (settings.agentExpandToWindow && canDetachChat) {
      // After the restore has rendered, so the window gets the new turns.
      requestAnimationFrame(() => handleDetachChat());
      return;
    }
    agentPanel.setOpen(true);
  }

  const [panelGuard, setPanelGuard] = useState(false);
  useEffect(() => {
    if (decidableCount === 0) setPanelGuard(false);
  }, [decidableCount]);
  function startPanelConversation() {
    if (pendingEdits.decidable.length > 0) {
      setPanelGuard(true);
      return;
    }
    setPanelGuard(false);
    conversation.reset();
  }

  // The review bar (ai/revision/ReviewBar.tsx) floats over the bottom of the pane
  // this editor scrolls in, while there is anything to decide - except
  // while Quick Ask, which has its own, is open, and on a phone while the
  // AI sheet covers the text.
  const rootRef = useRef<HTMLDivElement>(null);
  const [paneEl, setPaneEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPaneEl(
      (rootRef.current?.closest(".main-pane") as HTMLElement | null) ?? null,
    );
    setScrollEl(
      (rootRef.current?.closest(".editor-scroll") as HTMLElement | null) ??
        null,
    );
    setContentEl(
      (rootRef.current?.closest(".editor-content") as HTMLElement | null) ??
        null,
    );
  }, []);
  const reviewBarShown =
    isActive &&
    pendingEdits.decidable.length > 0 &&
    !inlineChat.visible &&
    !(phone && panelContainer);
  // On a phone, the edits arriving fold the AI sheet away so the text they
  // change is what's on screen, scrolled to the first of them; the bar
  // has the way back into the conversation.
  const hadDecidable = useRef(false);
  useEffect(() => {
    const has = pendingEdits.decidable.length > 0;
    if (has && !hadDecidable.current && phone && panelContainer && isActive) {
      agentPanel.setOpen(false);
      const first = pendingEdits.reviewStops[0];
      if (first) {
        pendingEdits.pointReview(first.callId, first.index);
        run((ctx) => revealPosition(ctx.get(editorViewCtx), first.from));
      }
    }
    hadDecidable.current = has;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEdits.decidable.length]);

  function stepReview(delta: 1 | -1) {
    const stop = pendingEdits.stepReview(delta);
    if (stop) run((ctx) => revealPosition(ctx.get(editorViewCtx), stop.from));
  }

  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null);
  const notes = useReviewNotes({
    run,
    reviewNotesRef,
    noMarginRef,
    conversation,
    quickConversation,
    pendingEdits,
    revisionDisplay: settings.revisionDisplay,
    agentPanel,
    t,
    showAiNotice,
  });

  // A card's sentence or "Show in text": point the review bar there and
  // bring it into view.
  function revealProposal(callId: string, index: number) {
    const stop = pendingEdits.pointReview(callId, index);
    if (!stop) return;
    run((ctx) => revealPosition(ctx.get(editorViewCtx), stop.from));
  }

  function popOutPanel() {
    handleDetachChat();
    agentPanel.setOpen(false);
  }

  function onContextMenu(e: MouseEvent) {
    // Portals (Quick Ask, the find bar) bubble React events through here:
    // their text fields keep the native Cut/Copy/Paste menu instead of the
    // editor's, whose Paste would have gone into the document.
    if (
      (e.target as HTMLElement).closest?.(
        ".inline-chat, .find-replace-bar, input, textarea",
      )
    )
      return;
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      imagePos: contextMenuTarget(run, e),
    });
  }

  return (
    <div
      ref={rootRef}
      onContextMenu={onContextMenu}
      // iOS fires mouseover on a tap; there the caret opens the suggestion.
      onMouseOver={
        phone
          ? undefined
          : (e) => {
              grammar.onMouseOver(e);
              notes.hoverNotes(e.target as HTMLElement);
            }
      }
      onMouseOut={phone ? undefined : grammar.onMouseOut}
      onPointerDown={() => (lastTouchRef.current = Date.now())}
      onPointerUp={() => (lastTouchRef.current = Date.now())}
    >
      <Milkdown />
      {isActive && scrollEl && contentEl && (
        <ReviewMargin
          view={notes.editorView}
          items={notes.marginItems}
          hot={notes.hotNote}
          scrollEl={scrollEl}
          contentEl={contentEl}
          labels={t}
          onHot={notes.setNoteHot}
          onDone={notes.doneNote}
          onAsk={notes.askAboutNote}
          onDecide={pendingEdits.decide}
          onCompact={notes.setNotesCompact}
          layoutKey={pendingEdits.previews}
        />
      )}
      <OpenReviewNote
        note={notes.openNoteData}
        at={notes.openNote}
        phone={phone}
        editorView={notes.editorView}
        t={t}
        onDone={notes.doneNote}
        onAsk={notes.askAboutNote}
        onClose={() => notes.setOpenNote(null)}
      />
      {paneEl &&
        createPortal(
          <Presence show={reviewBarShown} exitMs={200}>
            {reviewBarShown && (
              <ReviewBar
                labels={t}
                taken={pendingEdits.reviewCount.taken}
                total={pendingEdits.reviewCount.total}
                position={pendingEdits.stopIndex}
                stops={pendingEdits.reviewStops.length}
                phone={phone}
                onPrevious={() => stepReview(-1)}
                onNext={() => stepReview(1)}
                onAccept={pendingEdits.acceptAll}
                onReject={pendingEdits.rejectAll}
                onOpenChat={() => agentPanel.setOpen(true)}
                display={settings.revisionDisplay}
                displayName={(mode) => revisionDisplayName(t, mode)}
                onDisplay={(mode) => setSettings({ revisionDisplay: mode })}
              />
            )}
          </Presence>,
          paneEl,
        )}
      <Presence show={findReplace.open} exitMs={120}>
        {findReplace.open && (
          <FindReplaceBar findReplace={findReplace} labels={t} />
        )}
      </Presence>
      <Presence show={!!menu} exitMs={250}>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={(menu.phone ? buildPhoneMoreItems : buildContextMenuItems)(
              run,
              {
                t,
                imagePos: menu.imagePos,
                // Each AI item is only offered while its feature is enabled in
                // Settings. The provider-free newcomer guide always exposes Ask
                // AI so its real right-click entry point remains available even
                // if the user previously disabled Agent chat before replaying
                // the guide from Help. The phone's "More" leaves it to the
                // toolbar's own button.
                aiItems: [
                  ...((settings.enableAskAi || tutorialMock) && !menu.phone
                    ? [{ label: t.askAi, onSelect: openAgentConversation }]
                    : []),
                  ...(settings.enableCompletion
                    ? [
                        {
                          label: t.triggerCompletion,
                          onSelect: triggerCompletion,
                        },
                      ]
                    : []),
                  ...(settings.enableGrammarCheck
                    ? [
                        {
                          label: t.triggerGrammarCheck,
                          onSelect: triggerGrammarCheck,
                        },
                      ]
                    : []),
                ],
                copyOrCut,
                paste,
                selectAll,
                toggleFindReplace: findReplace.toggle,
                openTableDialog: () => setTableDialogOpen(true),
              },
            )}
            onClose={() => setMenu(null)}
          />
        )}
      </Presence>
      <Presence show={!!aiNotice} exitMs={120}>
        {aiNotice && (
          <PresenceDiv
            className="ai-notice floating-surface"
            role="status"
            onMouseEnter={holdAiNotice}
            onMouseLeave={releaseAiNotice}
          >
            {aiNotice}
          </PresenceDiv>
        )}
      </Presence>
      <Presence show={tableDialogOpen} exitMs={120}>
        {tableDialogOpen && (
          <InsertTableDialog
            title={t.insertTable}
            rowsLabel={t.insertTableRowsLabel}
            columnsLabel={t.insertTableColumnsLabel}
            confirmLabel={t.insertTableConfirm}
            cancelLabel={t.closePromptCancel}
            onInsert={(rows, cols) => insertTable(run, rows, cols)}
            onClose={() => setTableDialogOpen(false)}
          />
        )}
      </Presence>
      <Presence show={!!imageNameRequest} exitMs={120}>
        {imageNameRequest && (
          <ImageNameDialog
            request={imageNameRequest}
            title={t.imageNameDialogTitle}
            label={t.imageNameDialogLabel}
            invalidLabel={t.imageNameDialogInvalid}
            uploadLabel={t.imageNameDialogUpload}
            cancelLabel={t.closePromptCancel}
            onClose={closeImageNameDialog}
          />
        )}
      </Presence>
      <GrammarSuggestion
        grammar={grammar}
        phone={phone}
        t={t}
        onStale={() => showAiNotice(t.grammarApplyStale)}
      />
      {panelContainer &&
        createPortal(
          <AgentPanelView
            labels={{
              title: t.agentPanelTitle,
              newConversation: t.chatNewConversation,
              popOut: t.agentPanelPopOut,
              close: t.chatClose,
              tabChat: t.agentTabChat,
              tabMemory: t.agentTabMemory,
            }}
            onNewConversation={startPanelConversation}
            onPopOut={canDetachChat ? popOutPanel : undefined}
            onClose={() => agentPanel.setOpen(false)}
            tab={agentPanel.tab}
            onTabChange={agentPanel.setTab}
            memory={() => (
              <ProjectBar
                docPath={filePath}
                memory
                documentText={
                  run((ctx) => ctx.get(editorViewCtx).state.doc.textContent) ??
                  ""
                }
              />
            )}
          >
            {conversation.history.length === 0 && !conversation.busy && (
              <div className="agent-panel-empty">
                <span className="agent-panel-empty-mark" aria-hidden="true">
                  <SparkleIcon />
                </span>
                <p className="agent-panel-empty-text">
                  {/* No selecting-then-asking on a phone: the system's
                      own text menu takes the long press. */}
                  {isIOSApp ? t.agentPanelEmptyPhone : t.agentPanelEmpty}
                </p>
              </div>
            )}
            <ChatBody
              document=""
              selectedText={panelSelection?.text ?? null}
              selectionMarkdown={null}
              docPath={filePath}
              workspaceRoot={settings.agentWorkspaceRoot || null}
              conversation={conversation}
              defaultMode={settings.agentDefaultMode}
              defaultWebSearch={settings.enableWebSearch}
              tutorialMock={tutorialMock}
              labels={chatLabels(t, settings.language)}
              proposalStatus={pendingEdits.status}
              pendingCount={pendingEdits.decidable.length}
              fillHeight
              refreshContext={panelSendContext}
              onProposals={showProposals}
              onAcceptProposal={pendingEdits.accept}
              proposalSentences={pendingEdits.sentences}
              onDecideSentence={pendingEdits.decide}
              onRevealProposal={revealProposal}
              pendingBar={false}
              onLocateText={notes.locateText}
              noteNumber={(id) =>
                notes.notesBadged
                  ? (notes.notes.find((n) => n.id === id)?.num ?? null)
                  : null
              }
              onRejectProposal={pendingEdits.reject}
              onAcceptAll={pendingEdits.acceptAll}
              onRejectAll={pendingEdits.rejectAll}
              onRevealPending={handleFocusNext}
              footer={
                panelGuard && (
                  <CloseConfirmBar
                    labels={chatLabels(t, settings.language)}
                    pendingCount={pendingEdits.decidable.length}
                    onAcceptAll={pendingEdits.acceptAll}
                    onRejectAll={pendingEdits.rejectAll}
                    onClose={() => {
                      setPanelGuard(false);
                      conversation.reset();
                    }}
                    onCancel={() => setPanelGuard(false)}
                  />
                )
              }
            />
          </AgentPanelView>,
          panelContainer,
        )}
      {inlineChat.chatInfo &&
        inlineChat.visible &&
        quickAskHost &&
        // The panel renders through a portal into the zone widget's DOM
        // container (quick-ask-widget-plugin) - a real block in the
        // document flow, so it pushes content below it down instead of
        // floating over it. On a phone, into the page, docked above the
        // keyboard.
        createPortal(
          <InlineChat
            document={inlineChat.chatInfo.document}
            sendContext={quickSendContext}
            selectedText={inlineChat.chatInfo.selectedText}
            selectionMarkdown={inlineChat.chatInfo.selectionMarkdown}
            docPath={filePath}
            workspaceRoot={settings.agentWorkspaceRoot || null}
            conversation={quickConversation}
            // Edit-first: Quick Ask is opened on a passage to change it,
            // and Ask mode (the general default) turned "shorten this"
            // into a chat answer. Ask stays one click away in the picker.
            defaultMode="edit"
            defaultWebSearch={settings.enableWebSearch}
            tutorialMock={tutorialMock}
            labels={chatLabels(t, settings.language)}
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
            onDetach={expandQuickAsk}
            onNewConversation={startNewAgentConversation}
            onRequestClose={() => requestChatAction("close")}
            confirm={
              chatGuard
                ? {
                    onProceed: () => performChatAction(chatGuard),
                    onCancel: () => {
                      setChatGuard(null);
                      chatComposer()?.focus();
                    },
                  }
                : null
            }
            docked={phone}
            onDockResize={keepQuickAskTargetInView}
          />,
          quickAskHost,
        )}
    </div>
  );
}
