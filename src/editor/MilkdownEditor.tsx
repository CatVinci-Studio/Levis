import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Editor, rootCtx, defaultValueCtx, commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import {
  commonmark,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
} from "@milkdown/kit/preset/commonmark";
import { gfm, insertTableCommand } from "@milkdown/kit/preset/gfm";
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
import { AllSelection } from "@milkdown/kit/prose/state";
import { history } from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { taskListClickPlugin } from "./task-list-plugin";
import { syntaxHighlightPlugin } from "./syntax-highlight-plugin";
import { codeBlockLanguageView } from "./code-block-language-view";
import { createGhostTextPlugin } from "./ghost-text-plugin";
import { createGrammarCheckPlugin } from "./grammar-check-plugin";
import { mermaidPreviewPlugin } from "./mermaid-plugin";
import { tabExtendPlugin } from "./tab-extend-plugin";
import { escapeTrailingBlockPlugin } from "./escape-trailing-block-plugin";
import { createTypewriterPlugin } from "./typewriter-plugin";
import {
  remarkMathPlugin,
  mathInlineSchema,
  mathBlockSchema,
  mathInlineInputRule,
  mathBlockInputRule,
} from "./math-schema";
import { mathPreviewPlugin } from "./math-preview-plugin";
import { headingMarkerPlugin } from "./heading-marker-plugin";
import { markMarkerPlugin } from "./mark-marker-plugin";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { useSettings } from "../settings/SettingsContext";
import { Milkdown, useEditor, useInstance } from "@milkdown/react";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "katex/dist/katex.min.css";
import "./milkdown-theme.css";

interface MilkdownEditorProps {
  initialValue: string;
  onChange: (markdown: string) => void;
}

export function MilkdownEditor({ initialValue, onChange }: MilkdownEditorProps) {
  const [loading, getEditor] = useInstance();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { t, settings } = useSettings();

  // The editor plugin chain below is only built once (empty deps), so the
  // ghost-text plugin reads this ref to see live settings instead of the
  // value captured at construction time.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, initialValue);
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => onChange(markdown));
        })
        .use(commonmark)
        .use(gfm)
        .use(tabExtendPlugin)
        .use(escapeTrailingBlockPlugin)
        .use(history)
        .use(clipboard)
        .use(listener)
        .use(taskListClickPlugin)
        .use(syntaxHighlightPlugin)
        .use(codeBlockLanguageView)
        .use(
          createGhostTextPlugin({
            enabled: () => settingsRef.current.enableCompletion,
            provider: () => settingsRef.current.aiProvider,
          }),
        )
        .use(
          createGrammarCheckPlugin({
            enabled: () => settingsRef.current.enableGrammarCheck,
            provider: () => settingsRef.current.aiProvider,
          }),
        )
        .use(mermaidPreviewPlugin)
        .use(remarkMathPlugin)
        .use(mathInlineSchema)
        .use(mathBlockSchema)
        .use(mathInlineInputRule)
        .use(mathBlockInputRule)
        .use(mathPreviewPlugin)
        .use(headingMarkerPlugin)
        .use(markMarkerPlugin)
        .use(createTypewriterPlugin({ enabled: () => settingsRef.current.typewriterMode })),
    [],
  );

  function runTableCommand(command: (state: any, dispatch: any) => boolean) {
    if (loading) return;
    getEditor().action((ctx) => {
      const view = ctx.get(editorViewCtx);
      command(view.state, view.dispatch);
      view.focus();
    });
  }

  function runCommand(key: any) {
    if (loading) return;
    getEditor().action((ctx) => {
      ctx.get(commandsCtx).call(key);
      ctx.get(editorViewCtx).focus();
    });
  }

  function insertTable() {
    if (loading) return;
    getEditor().action((ctx) => {
      ctx.get(commandsCtx).call(insertTableCommand.key, { row: 3, col: 3 });
    });
  }

  function copyOrCut(cut: boolean) {
    if (loading) return;
    getEditor().action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const text = state.doc.textBetween(state.selection.from, state.selection.to, "\n");
      void (async () => {
        if (text) await navigator.clipboard.writeText(text);
        if (cut) view.dispatch(view.state.tr.deleteSelection());
        view.focus();
      })();
    });
  }

  function pasteFromClipboard() {
    if (loading) return;
    getEditor().action((ctx) => {
      const view = ctx.get(editorViewCtx);
      void (async () => {
        const text = await navigator.clipboard.readText();
        if (text) view.dispatch(view.state.tr.insertText(text));
        view.focus();
      })();
    });
  }

  function selectAll() {
    if (loading) return;
    getEditor().action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
      view.focus();
    });
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  function buildMenuItems(): (ContextMenuItem | "separator")[] {
    const clipboardItems: (ContextMenuItem | "separator")[] = [
      { label: t.cut, onSelect: () => copyOrCut(true) },
      { label: t.copy, onSelect: () => copyOrCut(false) },
      { label: t.paste, onSelect: pasteFromClipboard },
      { label: t.selectAll, onSelect: selectAll },
    ];

    const insertItems: (ContextMenuItem | "separator")[] = [
      { label: t.insertBulletList, onSelect: () => runCommand(wrapInBulletListCommand.key) },
      { label: t.insertOrderedList, onSelect: () => runCommand(wrapInOrderedListCommand.key) },
      { label: t.insertBlockquote, onSelect: () => runCommand(wrapInBlockquoteCommand.key) },
      { label: t.insertCodeBlock, onSelect: () => runCommand(createCodeBlockCommand.key) },
      { label: t.insertTable, onSelect: insertTable },
    ];

    if (loading) return [...clipboardItems, "separator", ...insertItems];

    const inTable = getEditor().action((ctx) => isInTable(ctx.get(editorViewCtx).state));
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
    <div onContextMenu={onContextMenu}>
      <Milkdown />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={buildMenuItems()} onClose={() => setMenu(null)} />}
    </div>
  );
}
