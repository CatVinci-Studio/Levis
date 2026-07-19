import { Plugin } from "@milkdown/kit/prose/state";
import { TextSelection } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { isInTable, selectedRect } from "@milkdown/kit/prose/tables";
import { isImeKeyEvent } from "./enclosure";

const ESCAPABLE_BLOCK_TYPES = new Set(["code_block", "math_block"]);

function isLastTopLevelNode($from: any, doc: any): boolean {
  if ($from.depth < 1) return false;
  const topPos = $from.before(1);
  const topNode = $from.node(1);
  return topPos + topNode.nodeSize === doc.content.size;
}

function isFirstTopLevelNode($from: any): boolean {
  return $from.depth >= 1 && $from.index(0) === 0;
}

// Nesting-safe version of the two checks above: true only when every
// ancestor level (list item within its list, list within the doc, etc.) is
// also the last/first child of its own parent - so e.g. the last item of a
// list still correctly reports "nothing after" even though the list itself
// has siblings before it.
function hasNothingAfter($pos: any): boolean {
  for (let d = 0; d < $pos.depth; d++) {
    if ($pos.index(d) < $pos.node(d).childCount - 1) return false;
  }
  return true;
}

function hasNothingBefore($pos: any): boolean {
  for (let d = 0; d < $pos.depth; d++) {
    if ($pos.index(d) > 0) return false;
  }
  return true;
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

function escapeBeforeFirstNode(view: any): boolean {
  const { state } = view;
  const paragraph = state.schema.nodes.paragraph.create();
  const tr = state.tr.insert(0, paragraph);
  tr.setSelection(TextSelection.near(tr.doc.resolve(1)));
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
 * A code block, math block, or table at the very start or end of the
 * document has nothing before/after it to move a cursor into - normal
 * arrow-key/Enter navigation can't escape it in that direction, and gets
 * stuck. This adds a trailing/leading empty paragraph on demand so there's
 * always somewhere to land, the same way pressing Enter after any other
 * block would work.
 *
 * The same "nothing to land on" gap exists for a plain non-empty last/first
 * line too, just for the vertical arrows: pressing Down on the document's
 * very last line, or Up on its very first, otherwise does nothing.
 */
export const escapeTrailingBlockPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (isImeKeyEvent(view, event)) return false;
          if (event.key === "Backspace") {
            return backspaceOutOfLeadingEmptyCodeBlock(view);
          }

          const isForwardKey =
            event.key === "ArrowDown" ||
            event.key === "ArrowRight" ||
            event.key === "Enter";
          const isBackwardKey =
            event.key === "ArrowUp" || event.key === "ArrowLeft";
          if (!isForwardKey && !isBackwardKey) return false;

          const { state } = view;
          const { $from, empty } = state.selection;
          if (!empty) return false;

          const inEscapableBlock = ESCAPABLE_BLOCK_TYPES.has(
            $from.parent.type.name,
          );
          const inTable = isInTable(state);

          if (!inEscapableBlock && !inTable) {
            // Plain block (paragraph, heading, list item, ...): pressing
            // straight down off the document's last line, or up off its
            // first, has nowhere to go by default. Only vertical arrows get
            // this - Enter/horizontal arrows already behave as expected via
            // ProseMirror's own defaults - and only when that boundary line
            // actually has content, so it doesn't keep stacking empty lines.
            if (event.key === "ArrowDown") {
              if (!view.endOfTextblock("down") || !hasNothingAfter($from))
                return false;
              if ($from.parent.content.size === 0) return false;
              return escapeAfterLastNode(view);
            }
            if (event.key === "ArrowUp") {
              if (!view.endOfTextblock("up") || !hasNothingBefore($from))
                return false;
              if ($from.parent.content.size === 0) return false;
              return escapeBeforeFirstNode(view);
            }
            return false;
          }

          if (inEscapableBlock) {
            if (isBackwardKey) {
              if (!isFirstTopLevelNode($from)) return false;
              if ($from.parentOffset !== 0) return false;
              return escapeBeforeFirstNode(view);
            }

            if (!isLastTopLevelNode($from, state.doc)) return false;
            const atEndOfBlock =
              $from.parentOffset === $from.parent.content.size;
            if (!atEndOfBlock) return false;

            if (event.key === "Enter") {
              const textBeforeCursor = $from.parent.textBetween(
                0,
                $from.parentOffset,
                "\n",
              );
              const onEmptyLastLine =
                textBeforeCursor.length === 0 ||
                textBeforeCursor.endsWith("\n");
              if (!onEmptyLastLine) return false;
            }
            return escapeAfterLastNode(view);
          }

          // Table: only escape from the bottom-right-most cell, moving down.
          if (event.key !== "ArrowDown") return false;
          const rect = selectedRect(state);
          const atLastCell =
            rect.bottom === rect.map.height && rect.right === rect.map.width;
          if (!atLastCell) return false;

          return escapeAfterLastNode(view);
        },
      },
    }),
);
