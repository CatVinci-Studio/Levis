import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { isInTable, selectedRect, addRowAfter, goToNextCell } from "@milkdown/kit/prose/tables";
import { isImeKeyEvent } from "./enclosure";

/**
 * Tab at the last cell of a table adds a new row and jumps into it (like
 * spreadsheets/Notion), instead of doing nothing. Registered after gfm in
 * the plugin chain, so gfm's own Tab-to-next-cell keymap already handles
 * every other case - this only ever fires once that's failed (i.e. at the
 * boundary) or when the selection is inside a code block.
 */
export const tabExtendPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (event.key !== "Tab" || event.shiftKey || isImeKeyEvent(view, event)) return false;

          const { state } = view;
          const { $from } = state.selection;

          if ($from.parent.type.name === "code_block") {
            view.dispatch(state.tr.insertText("  "));
            return true;
          }

          if (isInTable(state)) {
            const rect = selectedRect(state);
            const atLastCell = rect.bottom === rect.map.height && rect.right === rect.map.width;
            if (!atLastCell) return false;

            addRowAfter(view.state, view.dispatch);
            goToNextCell(1)(view.state, view.dispatch);
            return true;
          }

          return false;
        },
      },
    }),
);
