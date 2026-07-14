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
} from "../utils/events";
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
  const grammar = useGrammarPopover(run);

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

  function runTableCommand(command: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean) {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      command(view.state, view.dispatch);
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
      { label: t.alignLeft, onSelect: () => runTableCommand(setCellAttr("alignment", "left")) },
      { label: t.alignCenter, onSelect: () => runTableCommand(setCellAttr("alignment", "center")) },
      { label: t.alignRight, onSelect: () => runTableCommand(setCellAttr("alignment", "right")) },
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
          provider={settingsRef.current.aiProvider}
          webSearch={settingsRef.current.enableWebSearch}
          labels={{
            placeholder: t.agentInputPlaceholder,
            send: t.agentSend,
            thinking: t.agentThinking,
            attachFile: t.agentAttachFile,
            selectionHint: t.inlineChatSelectionHint,
            replaceSelection: t.agentReplaceSelection,
            insertAtCursor: t.agentInsertAtCursor,
            replaceDocument: t.agentReplaceDocument,
            proposalTitle: t.agentProposalTitle,
            proposalApply: t.agentProposalApply,
            proposalApplied: t.agentProposalApplied,
            actionNames: {
              replace: t.agentActionReplace,
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
