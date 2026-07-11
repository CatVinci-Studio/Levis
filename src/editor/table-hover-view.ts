import { $view } from "@milkdown/kit/utils";
import { tableSchema } from "@milkdown/kit/preset/gfm";
import { addRowAfter, addColumnAfter, TableMap } from "@milkdown/kit/prose/tables";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

type TableCommand = (state: EditorState, dispatch: (tr: Transaction) => void) => boolean;

/**
 * Moves the selection into the table's last cell (last row, last column) -
 * the anchor cell for both addRowAfter and addColumnAfter, since a cell that
 * sits in both the last row and the last column makes either command append
 * exactly one new row/column at the end. TableMap (rather than hand-walking
 * rows/cells) is what addRowAfter/addColumnAfter themselves use internally,
 * so it stays correct even across colspan/rowspan-merged cells.
 */
function focusLastCell(view: EditorView, tablePos: number): boolean {
  const table = view.state.doc.nodeAt(tablePos);
  if (!table) return false;
  const map = TableMap.get(table);
  const lastCellPos = tablePos + 1 + map.positionAt(map.height - 1, map.width - 1, table);
  const $pos = view.state.doc.resolve(Math.min(lastCellPos + 1, view.state.doc.content.size));
  view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
  return true;
}

function bindInsertButton(button: HTMLButtonElement, view: EditorView, getPos: () => number | undefined, command: TableCommand): void {
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const pos = getPos();
    if (pos == null || !focusLastCell(view, pos)) return;
    command(view.state, view.dispatch);
    view.focus();
  });
}

function makeInsertButton(className: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.contentEditable = "false";
  button.textContent = "+";
  return button;
}

/**
 * Table's default node view is a bare toDOM (["table", ["tbody", 0]]), with
 * row/column insertion reachable only through the right-click menu (see
 * MilkdownEditor's buildMenuItems, which drives the very same
 * addRowAfter/addColumnAfter commands used here). This wraps that same
 * <table><tbody> (still the real contentDOM) in a positioned wrapper with
 * small "+" affordances along the bottom and right edges, shown on hover.
 */
export const tableHoverView = $view(tableSchema.node, () => (node, view, getPos) => {
  const wrapper = document.createElement("div");
  wrapper.className = "table-wrapper";

  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);

  const addRowBtn = makeInsertButton("table-add-row-btn");
  bindInsertButton(addRowBtn, view, getPos, addRowAfter);

  const addColBtn = makeInsertButton("table-add-col-btn");
  bindInsertButton(addColBtn, view, getPos, addColumnAfter);

  wrapper.appendChild(table);
  wrapper.appendChild(addRowBtn);
  wrapper.appendChild(addColBtn);

  return {
    dom: wrapper,
    contentDOM: tbody,
    update(updatedNode) {
      return updatedNode.type === node.type;
    },
  };
});
