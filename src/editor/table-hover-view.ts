import { $prose, $view } from "@milkdown/kit/utils";
import { tableSchema } from "@milkdown/kit/preset/gfm";
import {
  addRowAfter,
  addColumnAfter,
  columnResizing,
  TableMap,
  updateColumnsOnResize,
} from "@milkdown/kit/prose/tables";

// Matches prosemirror-tables' columnResizing default, so the <colgroup> this
// view renders and the widths the resize drag writes share one baseline.
const DEFAULT_CELL_MIN_WIDTH = 100;
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

type TableCommand = (
  state: EditorState,
  dispatch: (tr: Transaction) => void,
) => boolean;

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
  const lastCellPos =
    tablePos + 1 + map.positionAt(map.height - 1, map.width - 1, table);
  const $pos = view.state.doc.resolve(
    Math.min(lastCellPos + 1, view.state.doc.content.size),
  );
  view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
  return true;
}

function bindInsertButton(
  button: HTMLButtonElement,
  view: EditorView,
  getPos: () => number | undefined,
  command: TableCommand,
): void {
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
 *
 * It also renders the <colgroup> that column resizing needs: the drag handled
 * by tableColumnResizing writes live widths straight into table.firstChild, so
 * the colgroup must be the table's first child. updateColumnsOnResize mirrors
 * prosemirror-tables' own TableView, keeping per-column widths (colwidth attrs)
 * in sync. Widths are session-only - GFM markdown can't store them.
 */
export const tableHoverView = $view(
  tableSchema.node,
  () => (node, view, getPos) => {
    let currentNode = node;
    const wrapper = document.createElement("div");
    wrapper.className = "table-wrapper";

    const table = document.createElement("table");
    table.style.setProperty(
      "--default-cell-min-width",
      `${DEFAULT_CELL_MIN_WIDTH}px`,
    );
    const colgroup = table.appendChild(document.createElement("colgroup"));
    const tbody = table.appendChild(document.createElement("tbody"));
    updateColumnsOnResize(node, colgroup, table, DEFAULT_CELL_MIN_WIDTH);

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
        if (updatedNode.type !== currentNode.type) return false;
        currentNode = updatedNode;
        updateColumnsOnResize(
          updatedNode,
          colgroup,
          table,
          DEFAULT_CELL_MIN_WIDTH,
        );
        return true;
      },
      ignoreMutation(record) {
        // The resize drag writes width styles straight onto the table and its
        // <col>s; don't let ProseMirror mistake those for content edits.
        return (
          record.type === "attributes" &&
          (record.target === table || colgroup.contains(record.target))
        );
      },
    };
  },
);

/**
 * Drag-to-resize table columns. prosemirror-tables' columnResizing supplies the
 * border handles, cursor, and colwidth updates; `View: null` stops it from
 * installing its own table node view (tableHoverView above is the view) - it
 * still drives the colgroup that view renders. Needs tableEditing, already in
 * the gfm preset.
 */
export const tableColumnResizing = $prose(() =>
  columnResizing({ View: null as unknown as undefined }),
);
