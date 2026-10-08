import { commandsCtx, editorViewCtx, type CmdKey } from "@milkdown/kit/core";
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
import type { ContextMenuItem } from "./ContextMenu";
import { readImagePresentation, writeImageWidth } from "./image-plugin";
import type { EditorRunner } from "./useEditorRunner";
import type { Strings } from "../i18n/strings";

// The editor commands behind the right-click menu, the native Format menu
// and the app-drawn Edit menu, and the right-click menu itself - plain
// functions over the editor runner, pulled out of MilkdownEditor.

type MenuEntry = ContextMenuItem | "separator";

// CmdKey<any>: the preset command keys vary in payload type (some
// unknown, some undefined) and all are called here without a payload.
export function runCommand(run: EditorRunner, key: CmdKey<any>) {
  run((ctx) => {
    ctx.get(commandsCtx).call(key);
    ctx.get(editorViewCtx).focus();
  });
}

export function insertTable(run: EditorRunner, rows: number, cols: number) {
  run((ctx) => {
    ctx.get(commandsCtx).call(insertTableCommand.key, { row: rows, col: cols });
  });
}

export function insertHeading(run: EditorRunner, level: number) {
  run((ctx) => {
    ctx.get(commandsCtx).call(wrapInHeadingCommand.key, level);
    ctx.get(editorViewCtx).focus();
  });
}

function runTableCommand(
  run: EditorRunner,
  command: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean,
) {
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    command(view.state, view.dispatch);
    view.focus();
  });
}

// Grows the selection to the whole row/column of the current cell - both
// as its own menu action and as the first step of column alignment.
function selectTableLine(run: EditorRunner, kind: "row" | "column") {
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
function alignTableColumn(
  run: EditorRunner,
  alignment: "left" | "center" | "right",
) {
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

function setImageWidth(
  run: EditorRunner,
  pos: number,
  widthPercent: number | null,
) {
  run((ctx) => {
    const view = ctx.get(editorViewCtx);
    const node = view.state.doc.nodeAt(pos);
    if (node?.type.name !== "image") return;
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        title: writeImageWidth(node.attrs.title as string | null, widthPercent),
      }),
    );
    view.focus();
  });
}

/**
 * Prepares the editor for a right-click and reports the image under the
 * pointer, if any (its doc position, for the width items).
 *
 * macOS WebKit selects the word under the pointer while handling a right
 * click in editable content - inside the engine, before any DOM event, so
 * it can't be prevented. But by the time contextmenu fires, only the DOM
 * selection has moved; ProseMirror's state still holds the real selection
 * (its readback is async). Pushing the state's selection back into the DOM
 * here undoes the word-select before it's ever painted or read back, so AI
 * context capture and the completion cursor never see it.
 */
export function contextMenuTarget(
  run: EditorRunner,
  e: { target: EventTarget | null },
): number | null {
  return (
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

      const target =
        e.target instanceof Element ? e.target.closest(".image-view") : null;
      if (!target) return null;
      try {
        const pos = view.posAtDOM(target, 0);
        return view.state.doc.nodeAt(pos)?.type.name === "image" ? pos : null;
      } catch {
        return null;
      }
    }) ?? null
  );
}

export interface ContextMenuOptions {
  t: Strings;
  /** From contextMenuTarget: the image right-clicked, if any. */
  imagePos: number | null;
  /** Already filtered down to the AI features that are switched on. */
  aiItems: ContextMenuItem[];
  copyOrCut: (cut: boolean) => void;
  paste: () => void;
  selectAll: () => void;
  toggleFindReplace: () => void;
  openTableDialog: () => void;
}

export function buildContextMenuItems(
  run: EditorRunner,
  options: ContextMenuOptions,
): MenuEntry[] {
  const { t, imagePos, aiItems } = options;

  const imageItems: MenuEntry[] = [];
  if (imagePos !== null) {
    const currentWidth =
      run((ctx) => {
        const node = ctx.get(editorViewCtx).state.doc.nodeAt(imagePos);
        return node?.type.name === "image"
          ? readImagePresentation(node.attrs.title as string | null)
              .widthPercent
          : null;
      }) ?? null;
    const widthItem = (widthPercent: number | null, label: string) => ({
      label: `${currentWidth === widthPercent ? "✓ " : ""}${label}`,
      onSelect: () => setImageWidth(run, imagePos, widthPercent),
    });
    imageItems.push(
      widthItem(null, t.imageWidthAuto),
      widthItem(30, t.imageWidth30),
      widthItem(50, t.imageWidth50),
      widthItem(70, t.imageWidth70),
      widthItem(100, t.imageWidth100),
      "separator",
    );
  }

  const clipboardItems: MenuEntry[] = [
    { label: t.cut, onSelect: () => options.copyOrCut(true) },
    { label: t.copy, onSelect: () => options.copyOrCut(false) },
    { label: t.paste, onSelect: options.paste },
    { label: t.selectAll, onSelect: options.selectAll },
    "separator",
    { label: t.findReplace, onSelect: options.toggleFindReplace },
    ...(aiItems.length > 0 ? (["separator", ...aiItems] as MenuEntry[]) : []),
  ];

  const insertItems: MenuEntry[] = [
    {
      label: t.insertBulletList,
      onSelect: () => runCommand(run, wrapInBulletListCommand.key),
    },
    {
      label: t.insertOrderedList,
      onSelect: () => runCommand(run, wrapInOrderedListCommand.key),
    },
    {
      label: t.insertBlockquote,
      onSelect: () => runCommand(run, wrapInBlockquoteCommand.key),
    },
    {
      label: t.insertCodeBlock,
      onSelect: () => runCommand(run, createCodeBlockCommand.key),
    },
    { label: t.insertTable, onSelect: options.openTableDialog },
  ];

  const inTable =
    run((ctx) => isInTable(ctx.get(editorViewCtx).state)) ?? false;
  if (!inTable) {
    return [...imageItems, ...clipboardItems, "separator", ...insertItems];
  }

  const table =
    (command: Parameters<typeof runTableCommand>[1]): (() => void) =>
    () =>
      runTableCommand(run, command);
  return [
    ...imageItems,
    ...clipboardItems,
    "separator",
    { label: t.alignLeft, onSelect: () => alignTableColumn(run, "left") },
    { label: t.alignCenter, onSelect: () => alignTableColumn(run, "center") },
    { label: t.alignRight, onSelect: () => alignTableColumn(run, "right") },
    "separator",
    { label: t.selectRow, onSelect: () => selectTableLine(run, "row") },
    { label: t.selectColumn, onSelect: () => selectTableLine(run, "column") },
    "separator",
    { label: t.insertRowAbove, onSelect: table(addRowBefore) },
    { label: t.insertRowBelow, onSelect: table(addRowAfter) },
    { label: t.insertColumnLeft, onSelect: table(addColumnBefore) },
    { label: t.insertColumnRight, onSelect: table(addColumnAfter) },
    "separator",
    { label: t.deleteRow, onSelect: table(deleteRow), danger: true },
    { label: t.deleteColumn, onSelect: table(deleteColumn), danger: true },
    { label: t.deleteTable, onSelect: table(deleteTable), danger: true },
  ];
}
