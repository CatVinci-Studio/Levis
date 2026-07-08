import { $prose } from "@milkdown/kit/utils";
import { Plugin } from "@milkdown/kit/prose/state";

const CHECKBOX_HIT_WIDTH = 24;

/**
 * Milkdown's gfm preset only marks task list items with a `data-checked`
 * attribute — it renders no actual checkbox glyph or click handling. This
 * plugin adds a CSS-drawn checkbox (see milkdown-theme.css) and toggles the
 * node's `checked` attr when that glyph area is clicked, without pulling in
 * @milkdown/components (which drags in a Vue runtime for one checkbox).
 */
export const taskListClickPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleClickOn(view, _pos, node, nodePos, event) {
          if (node.type.name !== "list_item" || node.attrs.checked == null) return false;

          const target = event.target as HTMLElement | null;
          const li = target?.closest('li[data-item-type="task"]') as HTMLElement | null;
          if (!li) return false;

          const rect = li.getBoundingClientRect();
          if (event.clientX - rect.left > CHECKBOX_HIT_WIDTH) return false;

          view.dispatch(
            view.state.tr.setNodeMarkup(nodePos, undefined, {
              ...node.attrs,
              checked: !node.attrs.checked,
            }),
          );
          return true;
        },
      },
    }),
);
