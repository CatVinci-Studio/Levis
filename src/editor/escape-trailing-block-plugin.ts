import { Plugin } from "@milkdown/kit/prose/state";
import { TextSelection } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { isInTable, selectedRect } from "@milkdown/kit/prose/tables";

function isLastTopLevelNode($from: any, doc: any): boolean {
  if ($from.depth < 1) return false;
  const topPos = $from.before(1);
  const topNode = $from.node(1);
  return topPos + topNode.nodeSize === doc.content.size;
}

function escapeAfterLastNode(view: any): boolean {
  const { state } = view;
  const paragraph = state.schema.nodes.paragraph.create();
  const insertPos = state.doc.content.size;
  const tr = state.tr.insert(insertPos, paragraph);
  tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size - 1)));
  view.dispatch(tr);
  view.focus();
  return true;
}

/**
 * ProseMirror's default backspace-at-start-of-block handling merges into
 * the previous block, but an empty code block with nothing before it (the
 * very first node in the doc) has nothing to merge into, so backspace does
 * nothing and it's stuck. Fall back to converting it into a paragraph,
 * same as backspacing an empty heading/blockquote normally would.
 */
function backspaceOutOfLeadingEmptyCodeBlock(view: any): boolean {
  const { state } = view;
  const { $from, empty } = state.selection;
  if (!empty) return false;
  if ($from.parent.type.name !== "code_block") return false;
  if ($from.parentOffset !== 0 || $from.parent.content.size !== 0) return false;
  if ($from.index(0) !== 0) return false; // there's a top-level sibling before it; default handling applies

  const paragraphType = state.schema.nodes.paragraph;
  const pos = $from.before($from.depth);
  const tr = state.tr.setNodeMarkup(pos, paragraphType);
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
  view.dispatch(tr);
  return true;
}

/**
 * A code block or table that's the last node in the document has nothing
 * below it to move into - normally Down/Enter can't escape it. This adds a
 * trailing empty paragraph and moves the cursor there, same as pressing
 * enter after any other block would.
 */
export const escapeTrailingBlockPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (event.key === "Backspace") {
            return backspaceOutOfLeadingEmptyCodeBlock(view);
          }
          if (event.key !== "ArrowDown" && event.key !== "Enter") return false;

          const { state } = view;
          const { $from, empty } = state.selection;
          if (!empty) return false;

          const inCodeBlock = $from.parent.type.name === "code_block";
          const inTable = isInTable(state);
          if (!inCodeBlock && !inTable) return false;
          if (!isLastTopLevelNode($from, state.doc)) return false;

          if (inCodeBlock) {
            const textBeforeCursor = $from.parent.textBetween(0, $from.parentOffset, "\n");
            const atEndOfBlock = $from.parentOffset === $from.parent.content.size;
            if (!atEndOfBlock) return false;

            const onEmptyLastLine = textBeforeCursor.length === 0 || textBeforeCursor.endsWith("\n");
            if (event.key === "ArrowDown" || (event.key === "Enter" && onEmptyLastLine)) {
              return escapeAfterLastNode(view);
            }
            return false;
          }

          // Table: only escape from the bottom-right-most cell.
          const rect = selectedRect(state);
          const atLastCell = rect.bottom === rect.map.height && rect.right === rect.map.width;
          if (!atLastCell) return false;

          if (event.key === "ArrowDown") {
            return escapeAfterLastNode(view);
          }
          return false;
        },
      },
    }),
);
