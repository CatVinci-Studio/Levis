import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
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
import { ChatSidebar } from "../ai/chat/ChatSidebar";
import { chatLabels } from "../ai/chat/chat-labels";
import { useDetachedChat } from "../ai/chat/useDetachedChat";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { InsertTableDialog } from "./InsertTableDialog";
import { FindReplaceBar } from "./FindReplaceBar";
import { useFindReplace } from "./useFindReplace";
import { useEditorRunner } from "./useEditorRunner";
import { useEditorClipboard } from "./useEditorClipboard";
import { useAiActions } from "../ai/useAiActions";
import { useAgentConversation } from "../ai/useAgentConversation";
import { useInlineChat, type InlineChatInfo } from "../ai/useInlineChat";
import { setChatSelection } from "../ai/chat-selection-plugin";
import { usePendingEdits } from "../ai/usePendingEdits";
import {
  prefersReducedMotion,
  streamPendingInsertText,
} from "../ai/pending-edit-plugin";
import { draftProposal } from "../ai/chat/partial-tool-args";
import { parseProposal } from "../ai/chat/proposal";
import type { StreamEvent } from "../ipc";
import { useGrammarPopover } from "../ai/useGrammarPopover";
import { useSettings } from "../settings/SettingsContext";
import { useLatest } from "../utils/useLatest";
import { useWindowEvent } from "../utils/useWindowEvent";
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
  /** True while the onboarding tour runs: real AI is muted end to end -
   *  typing-triggered plugins go quiet (editor-extensions), on-demand
   *  triggers are ignored, and the chat answers from a pre-written script
   *  instead of the backend. First-run users have no AI account yet. */
  tutorialMock?: boolean;
  /** EditorPane's dock element the chat sidebar portals into - the docked
   *  column must live beside the scroll container, not inside it. */
  chatDock?: HTMLElement | null;
}

export function MilkdownEditor({
  filePath,
  initialValue,
  onChange,
  tutorialMock = false,
  chatDock = null,
}: MilkdownEditorProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  // Which in-app surface renders the live chat: Quick Ask (caret-anchored
  // popup, the default entry point) or the docked sidebar. One conversation,
  // two renderings - switching surface never touches the chat state, which
  // is what makes "open in sidebar" seamless rather than a handoff.
  const [chatSurface, setChatSurface] = useState<"quick" | "dock">("quick");
  const { t, settings } = useSettings();

  // The editor plugin chain below is only built once (empty deps), so
  // plugins read this ref to see live settings instead of the value
  // captured at construction time.
  const settingsRef = useLatest(settings);
  const filePathRef = useLatest(filePath);
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
  });

  useEditor(
    (root) =>
      withEditorExtensions(
        Editor.make().config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, initialValue);
          // Typora-compatible themes style their content under `#write` -
          // aliasing it here lets most community Typora themes' CSS apply
          // directly to our content with no rewriting.
          ctx.set(editorViewOptionsCtx, { attributes: { id: "write" } });
          ctx
            .get(listenerCtx)
            .markdownUpdated((_ctx, markdown) => onChange(markdown));
        }),
        settingsRef,
        filePathRef,
        {
          onAccept: (callId) => pendingEditActionsRef.current.onAccept(callId),
          onReject: (callId) => pendingEditActionsRef.current.onReject(callId),
          onPreviewsChange: (previews) =>
            pendingEditActionsRef.current.onPreviewsChange(previews),
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
  const pendingEdits = usePendingEdits(run);
  useEffect(() => {
    pendingEditActionsRef.current = {
      onAccept: pendingEdits.accept,
      onReject: pendingEdits.reject,
      onPreviewsChange: pendingEdits.syncFromPlugin,
    };
  }, [pendingEdits.accept, pendingEdits.reject, pendingEdits.syncFromPlugin]);
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
        if (proposal?.text !== undefined)
          streamPendingInsertText(event.turn.call_id, proposal.text, true);
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

  const detachedChat = useDetachedChat({
    onProposals: showProposals,
    onAccept: (callId) => pendingEdits.accept(callId),
    onReject: (callId) => pendingEdits.reject(callId),
    onAcceptAll: () => pendingEdits.acceptAll(),
    onRejectAll: () => pendingEdits.rejectAll(),
    // The window handed its conversation back on close - carry on with it
    // in the docked sidebar (a returning conversation is by definition a
    // multi-turn one) rather than dropping the exchange.
    onReembed: (conversationId, turns) => {
      if (turns.length > 0)
        conversation.restore({
          id: conversationId,
          docPath: filePathRef.current,
          title: "",
          updatedAt: Date.now(),
          turns,
        });
      setChatSurface("dock");
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

  // The detached window has no editor state of its own, so it's fed: the
  // document/selection as they now read, and every proposal's status.
  useEffect(() => {
    if (!detachedChatLabel || !inlineChat.chatInfo) return;
    pushChatContext({
      document: inlineChat.chatInfo.document,
      selectedText: inlineChat.chatInfo.selectedText,
      selectionMarkdown: inlineChat.chatInfo.selectionMarkdown,
      docPath: filePath,
    });
  }, [detachedChatLabel, pushChatContext, inlineChat.chatInfo, filePath]);

  useEffect(() => {
    if (detachedChatLabel) pushChatStatuses(pendingEdits.allStatuses);
  }, [detachedChatLabel, pushChatStatuses, pendingEdits.allStatuses]);

  /** Scrolls to the first undecided edit. In a long conversation the cards
   *  scroll away, so the pinned summary bar needs a way back to the text. */
  function revealFirstPending() {
    const first = pendingEdits.previews[0];
    if (!first) return;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      // near(), not create(): an anchored proposal's `from` is the position
      // BEFORE a block node, which is not a valid text position - create()
      // throws there. near() snaps to the closest one it can select.
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.near(view.state.doc.resolve(first.from)))
          .scrollIntoView(),
      );
      view.focus();
    });
  }

  function handleDetachChat() {
    const info = inlineChat.chatInfo;
    if (!info) return;
    void detachedChat.detach(
      {
        context: {
          document: info.document,
          selectedText: info.selectedText,
          selectionMarkdown: info.selectionMarkdown,
          docPath: filePath,
        },
        conversationId: conversation.conversationId,
        turns: conversation.history,
        statuses: pendingEdits.allStatuses,
      },
      t.chatWindowTitle,
    );
    // The popup gives way to the window; chatInfo stays set so proposals
    // arriving from the window still resolve against this request's context.
    inlineChat.hide();
  }

  function openNewAgentConversation() {
    conversation.reset();
    // A fresh ask always starts as the lightweight caret-side popup;
    // escalating to the sidebar is the user's explicit move.
    setChatSurface("quick");
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
  // and make sure the inline chat is open to show it.
  useWindowEvent(RESTORE_CHAT_EVENT, (e) => {
    if (!isOnScreen()) return;
    const entry = (e as CustomEvent<ChatHistoryEntry>).detail;
    if (!entry || !Array.isArray(entry.turns)) return;
    conversation.restore(entry);
    // A restored conversation goes straight to the sidebar - it exists to
    // be read through, which is the sidebar's job, not Quick Ask's.
    setChatSurface("dock");
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

  /** The prop bag both in-app chat surfaces share (ChatSurfaceProps) - one
   *  definition, so Quick Ask and the sidebar can't be handed different
   *  wiring for the same conversation. */
  function chatSurfaceProps(info: InlineChatInfo) {
    return {
      document: info.document,
      selectedText: info.selectedText,
      selectionMarkdown: info.selectionMarkdown,
      docPath: filePath,
      conversation,
      tutorialMock,
      labels: chatLabels(t),
      onProposals: showProposals,
      proposalStatus: pendingEdits.status,
      onAcceptProposal: pendingEdits.accept,
      onRejectProposal: pendingEdits.reject,
      onAcceptAll: pendingEdits.acceptAll,
      onRejectAll: pendingEdits.rejectAll,
      // Streaming previews are visible but not yet decidable - the pending
      // bar (count + accept/reject all) must not offer them.
      pendingCount: pendingEdits.previews.filter((p) => !p.streaming).length,
      onRevealPending: revealFirstPending,
      onClose: inlineChat.close,
    };
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
        (chatSurface === "dock" && chatDock ? (
          // The docked surface renders through a portal into EditorPane's
          // dock slot - the chat state stays right here, only the pixels
          // move outside the scroll container.
          createPortal(
            <ChatSidebar
              {...chatSurfaceProps(inlineChat.chatInfo)}
              onDetach={handleDetachChat}
            />,
            chatDock,
          )
        ) : (
          <InlineChat
            {...chatSurfaceProps(inlineChat.chatInfo)}
            run={run}
            chatInfo={inlineChat.chatInfo}
            onOpenSidebar={() => setChatSurface("dock")}
          />
        ))}
    </div>
  );
}
