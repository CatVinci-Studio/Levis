import { type MouseEvent, useEffect, useRef, useState } from "react";
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
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { listenerCtx } from "@milkdown/kit/plugin/listener";
import { withEditorExtensions, type PendingEditCallbacks } from "./editor-extensions";
import { GrammarPopover } from "../ai/GrammarPopover";
import { InlineChatBar } from "../ai/InlineChatBar";
import { PendingEditControls } from "../ai/PendingEditControls";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { InsertTableDialog } from "./InsertTableDialog";
import { FindReplaceBar } from "./FindReplaceBar";
import { useFindReplace } from "./useFindReplace";
import { useEditorRunner } from "./useEditorRunner";
import { useEditorClipboard } from "./useEditorClipboard";
import { useAiActions } from "../ai/useAiActions";
import { useAgentConversation } from "../ai/useAgentConversation";
import { useInlineChat } from "../ai/useInlineChat";
import { usePendingEdits } from "../ai/usePendingEdits";
import { useGrammarPopover } from "../ai/useGrammarPopover";
import { useSettings } from "../settings/SettingsContext";
import { useLatest } from "../utils/useLatest";
import { useWindowEvent } from "../utils/useWindowEvent";
import {
  TRIGGER_COMPLETION_EVENT,
  TRIGGER_GRAMMAR_CHECK_EVENT,
  TOGGLE_FLOATING_CHAT_EVENT,
  TOGGLE_FIND_REPLACE_EVENT,
  INSERT_CLIPBOARD_TEXT_EVENT,
  RESTORE_CHAT_EVENT,
  INSERT_BLOCK_EVENT,
} from "../utils/events";
import type { ChatHistoryEntry } from "../ai/chat-history";
import { Milkdown, useEditor } from "@milkdown/react";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "katex/dist/katex.min.css";
import "./milkdown-theme.css";
import "./content-themes.css";

interface MilkdownEditorProps {
  filePath: string | null;
  initialValue: string;
  onChange: (markdown: string) => void;
}

export function MilkdownEditor({ filePath, initialValue, onChange }: MilkdownEditorProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const { t, settings } = useSettings();

  // The editor plugin chain below is only built once (empty deps), so
  // plugins read this ref to see live settings instead of the value
  // captured at construction time.
  const settingsRef = useLatest(settings);
  const filePathRef = useLatest(filePath);

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
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => onChange(markdown));
        }),
        settingsRef,
        filePathRef,
        {
          onAccept: (callId) => pendingEditActionsRef.current.onAccept(callId),
          onReject: (callId) => pendingEditActionsRef.current.onReject(callId),
          onPreviewsChange: (previews) => pendingEditActionsRef.current.onPreviewsChange(previews),
        },
      ),
    [],
  );

  const run = useEditorRunner();
  const { copyOrCut, paste, selectAll, insertText } = useEditorClipboard(run);
  const { triggerCompletion, triggerGrammarCheck } = useAiActions(run, () => settingsRef.current);
  const inlineChat = useInlineChat(run, () => ({
    applyStale: t.agentApplyStale,
    proposalFailed: t.agentProposalFailed,
  }));
  const pendingEdits = usePendingEdits(run);
  useEffect(() => {
    pendingEditActionsRef.current = {
      onAccept: pendingEdits.accept,
      onReject: pendingEdits.reject,
      onPreviewsChange: pendingEdits.syncFromPlugin,
    };
  }, [pendingEdits.accept, pendingEdits.reject, pendingEdits.syncFromPlugin]);
  // Owned here, not by the chat bar, so closing/reopening the bar continues
  // the same conversation ("New chat" inside the bar is what clears it).
  const agentModel = {
    codex: settings.codexAgentModel,
    claude: settings.claudeAgentModel,
    apikey: settings.apikeyAgentModel,
    custom: undefined,
  }[settings.aiProvider];
  const conversation = useAgentConversation(filePath, settings.aiProvider, settings.enableWebSearch, agentModel);
  const grammar = useGrammarPopover(run, () => t.grammarApplyStale);
  const findReplace = useFindReplace(run);

  // Shortcuts respect the same feature toggles as the context menu items -
  // a feature turned off in Settings is off through every entry point.
  useWindowEvent(TRIGGER_COMPLETION_EVENT, () => settings.enableCompletion && triggerCompletion());
  useWindowEvent(TRIGGER_GRAMMAR_CHECK_EVENT, () => settings.enableGrammarCheck && triggerGrammarCheck());
  useWindowEvent(TOGGLE_FLOATING_CHAT_EVENT, () => settings.enableAskAi && inlineChat.toggle());
  useWindowEvent(TOGGLE_FIND_REPLACE_EVENT, () => findReplace.toggle());

  // Clipboard-history panel clicks: carries the text as CustomEvent detail.
  useWindowEvent(INSERT_CLIPBOARD_TEXT_EVENT, (e) => {
    const text = (e as CustomEvent<string>).detail;
    if (typeof text === "string" && text) insertText(text);
  });

  // Native Format menu clicks (see menu-insert-block in src-tauri/src/lib.rs,
  // relayed through App.tsx): same commands the right-click Insert submenu
  // below uses, keyed by the menu item's kind string instead of a click.
  useWindowEvent(INSERT_BLOCK_EVENT, (e) => {
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
    const entry = (e as CustomEvent<ChatHistoryEntry>).detail;
    if (!entry || !Array.isArray(entry.turns)) return;
    conversation.restore(entry);
    inlineChat.open();
  });

  function runTableCommand(command: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean) {
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
      const selection = kind === "row" ? CellSelection.rowSelection($cell) : CellSelection.colSelection($cell);
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
      view.dispatch(view.state.tr.setSelection(CellSelection.colSelection($cell)));
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
      ctx.get(commandsCtx).call(insertTableCommand.key, { row: rows, col: cols });
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
        window.getSelection()?.setBaseAndExtent(a.node, a.offset, h.node, h.offset);
      } catch {
        // Selection not representable in the DOM right now - leave it alone.
      }
    });
    setMenu({ x: e.clientX, y: e.clientY });
  }

  function buildMenuItems(): (ContextMenuItem | "separator")[] {
    // Each AI item is only offered while its feature is enabled in Settings.
    const aiItems: ContextMenuItem[] = [
      ...(settings.enableAskAi ? [{ label: t.askAi, onSelect: inlineChat.toggle }] : []),
      ...(settings.enableCompletion ? [{ label: t.triggerCompletion, onSelect: triggerCompletion }] : []),
      ...(settings.enableGrammarCheck ? [{ label: t.triggerGrammarCheck, onSelect: triggerGrammarCheck }] : []),
    ];

    const clipboardItems: (ContextMenuItem | "separator")[] = [
      { label: t.cut, onSelect: () => copyOrCut(true) },
      { label: t.copy, onSelect: () => copyOrCut(false) },
      { label: t.paste, onSelect: paste },
      { label: t.selectAll, onSelect: selectAll },
      "separator",
      { label: t.findReplace, onSelect: findReplace.toggle },
      ...(aiItems.length > 0 ? (["separator", ...aiItems] as (ContextMenuItem | "separator")[]) : []),
    ];

    const insertItems: (ContextMenuItem | "separator")[] = [
      { label: t.insertBulletList, onSelect: () => runCommand(wrapInBulletListCommand.key) },
      { label: t.insertOrderedList, onSelect: () => runCommand(wrapInOrderedListCommand.key) },
      { label: t.insertBlockquote, onSelect: () => runCommand(wrapInBlockquoteCommand.key) },
      { label: t.insertCodeBlock, onSelect: () => runCommand(createCodeBlockCommand.key) },
      { label: t.insertTable, onSelect: () => setTableDialogOpen(true) },
    ];

    const inTable = run((ctx) => isInTable(ctx.get(editorViewCtx).state)) ?? false;
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
      { label: t.insertRowAbove, onSelect: () => runTableCommand(addRowBefore) },
      { label: t.insertRowBelow, onSelect: () => runTableCommand(addRowAfter) },
      { label: t.insertColumnLeft, onSelect: () => runTableCommand(addColumnBefore) },
      { label: t.insertColumnRight, onSelect: () => runTableCommand(addColumnAfter) },
      "separator",
      { label: t.deleteRow, onSelect: () => runTableCommand(deleteRow), danger: true },
      { label: t.deleteColumn, onSelect: () => runTableCommand(deleteColumn), danger: true },
      { label: t.deleteTable, onSelect: () => runTableCommand(deleteTable), danger: true },
    ];
  }

  return (
    <div onContextMenu={onContextMenu} onMouseOver={grammar.onMouseOver} onMouseOut={grammar.onMouseOut}>
      <Milkdown />
      {findReplace.open && (
        <FindReplaceBar findReplace={findReplace} labels={t} />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={buildMenuItems()} onClose={() => setMenu(null)} />}
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
      {inlineChat.chatInfo && (
        <InlineChatBar
          x={inlineChat.chatInfo.x}
          y={inlineChat.chatInfo.y}
          document={inlineChat.chatInfo.document}
          selectedText={inlineChat.chatInfo.selectedText}
          docPath={filePath}
          chatInfo={inlineChat.chatInfo}
          conversation={conversation}
          labels={{
            placeholder: t.agentInputPlaceholder,
            send: t.agentSend,
            thinking: t.agentThinking,
            newChat: t.agentNewChat,
            attachFile: t.agentAttachFile,
            selectedChars: t.chatSelectedChars,
            replaceSelection: t.agentReplaceSelection,
            insertAtCursor: t.agentInsertAtCursor,
            replaceDocument: t.agentReplaceDocument,
            proposalTitle: t.agentProposalTitle,
            proposalApply: t.agentProposalApply,
            proposalApplied: t.agentProposalApplied,
            proposalStatus: {
              accepted: t.proposalStatusAccepted,
              rejected: t.proposalStatusRejected,
              invalid: t.proposalStatusInvalid,
            },
            proposalAccept: t.proposalAccept,
            proposalReject: t.proposalReject,
            actionNames: {
              replace: t.agentActionReplace,
              replace_selection: t.agentActionReplaceSelection,
              insert_before: t.agentActionInsertBefore,
              insert_after: t.agentActionInsertAfter,
              delete: t.agentActionDelete,
              append: t.agentActionAppend,
            },
          }}
          onApply={inlineChat.applyResult}
          onApplyProposal={inlineChat.applyProposal}
          onProposals={pendingEdits.showPreviews}
          proposalStatus={pendingEdits.status}
          onAcceptProposal={pendingEdits.accept}
          onRejectProposal={pendingEdits.reject}
          onClose={inlineChat.close}
        />
      )}
      {pendingEdits.previews.length > 0 && (
        <PendingEditControls
          run={run}
          previews={pendingEdits.previews}
          labels={{
            accept: t.pendingAccept,
            reject: t.pendingReject,
            acceptAll: t.pendingAcceptAll,
            rejectAll: t.pendingRejectAll,
            ofCount: t.pendingOfCount,
          }}
          onAccept={pendingEdits.accept}
          onReject={pendingEdits.reject}
          onAcceptAll={pendingEdits.acceptAll}
          onRejectAll={pendingEdits.rejectAll}
        />
      )}
    </div>
  );
}
