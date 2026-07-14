import { type MouseEvent, useEffect, useState } from "react";
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
import { withEditorExtensions } from "./editor-extensions";
import { GrammarPopover } from "../ai/GrammarPopover";
import { InlineChatBar } from "../ai/InlineChatBar";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { useEditorRunner } from "./useEditorRunner";
import { useEditorClipboard } from "./useEditorClipboard";
import { useAiActions } from "../ai/useAiActions";
import { useAgentConversation } from "../ai/useAgentConversation";
import { useInlineChat } from "../ai/useInlineChat";
import { useGrammarPopover } from "../ai/useGrammarPopover";
import { useSettings } from "../settings/SettingsContext";
import { useLatest } from "../utils/useLatest";
import { useWindowEvent } from "../utils/useWindowEvent";
import {
  TRIGGER_COMPLETION_EVENT,
  TRIGGER_GRAMMAR_CHECK_EVENT,
  TOGGLE_FLOATING_CHAT_EVENT,
  INSERT_CLIPBOARD_TEXT_EVENT,
  RESTORE_CHAT_EVENT,
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
  const { t, settings } = useSettings();

  // The editor plugin chain below is only built once (empty deps), so
  // plugins read this ref to see live settings instead of the value
  // captured at construction time.
  const settingsRef = useLatest(settings);
  const filePathRef = useLatest(filePath);

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
  // Owned here, not by the chat bar, so closing/reopening the bar continues
  // the same conversation ("New chat" inside the bar is what clears it).
  const conversation = useAgentConversation(filePath, settings.aiProvider, settings.enableWebSearch);
  const grammar = useGrammarPopover(run, () => t.grammarApplyStale);

  // Shortcuts respect the same feature toggles as the context menu items -
  // a feature turned off in Settings is off through every entry point.
  useWindowEvent(TRIGGER_COMPLETION_EVENT, () => settings.enableCompletion && triggerCompletion());
  useWindowEvent(TRIGGER_GRAMMAR_CHECK_EVENT, () => settings.enableGrammarCheck && triggerGrammarCheck());
  useWindowEvent(TOGGLE_FLOATING_CHAT_EVENT, () => settings.enableAskAi && inlineChat.toggle());

  // Clipboard-history panel clicks: carries the text as CustomEvent detail,
  // so it can't go through useWindowEvent's payload-less handlers.
  useEffect(() => {
    const onInsert = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (typeof text === "string" && text) insertText(text);
    };
    window.addEventListener(INSERT_CLIPBOARD_TEXT_EVENT, onInsert);
    return () => window.removeEventListener(INSERT_CLIPBOARD_TEXT_EVENT, onInsert);
  }, [insertText]);

  // Chat-history panel clicks: load the saved conversation as the live one
  // and make sure the inline chat is open to show it.
  useEffect(() => {
    const onRestore = (e: Event) => {
      const entry = (e as CustomEvent<ChatHistoryEntry>).detail;
      if (!entry || !Array.isArray(entry.turns)) return;
      conversation.restore(entry);
      inlineChat.open();
    };
    window.addEventListener(RESTORE_CHAT_EVENT, onRestore);
    return () => window.removeEventListener(RESTORE_CHAT_EVENT, onRestore);
  }, [conversation.restore, inlineChat.open]);

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

  function insertTable() {
    run((ctx) => {
      ctx.get(commandsCtx).call(insertTableCommand.key, { row: 3, col: 3 });
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
      ...(aiItems.length > 0 ? (["separator", ...aiItems] as (ContextMenuItem | "separator")[]) : []),
    ];

    const insertItems: (ContextMenuItem | "separator")[] = [
      { label: t.insertBulletList, onSelect: () => runCommand(wrapInBulletListCommand.key) },
      { label: t.insertOrderedList, onSelect: () => runCommand(wrapInOrderedListCommand.key) },
      { label: t.insertBlockquote, onSelect: () => runCommand(wrapInBlockquoteCommand.key) },
      { label: t.insertCodeBlock, onSelect: () => runCommand(createCodeBlockCommand.key) },
      { label: t.insertTable, onSelect: insertTable },
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
      {menu && <ContextMenu x={menu.x} y={menu.y} items={buildMenuItems()} onClose={() => setMenu(null)} />}
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
          onClose={inlineChat.close}
        />
      )}
    </div>
  );
}
