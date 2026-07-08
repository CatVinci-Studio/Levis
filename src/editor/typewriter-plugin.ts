import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";

/**
 * Typora/iA Writer-style typewriter scrolling: keeps the cursor's line
 * pinned near vertical center of the scroll container instead of letting it
 * drift to the bottom as you type. Requires `.editor-content` to have
 * enough top/bottom padding for the first/last lines to actually reach
 * center (see `.typewriter-active` in App.css).
 */
export function createTypewriterPlugin(options: { enabled: () => boolean }) {
  return $prose(
    () =>
      new Plugin({
        view() {
          return {
            update(view, prevState) {
              if (!options.enabled()) return;
              if (view.composing) return;
              if (view.state.doc.eq(prevState.doc) && view.state.selection.eq(prevState.selection)) return;

              const scrollContainer = view.dom.closest(".editor-scroll");
              if (!scrollContainer) return;

              const coords = view.coordsAtPos(view.state.selection.head);
              const containerRect = scrollContainer.getBoundingClientRect();
              const targetY = containerRect.top + containerRect.height / 2;
              const delta = coords.top - targetY;
              if (Math.abs(delta) > 2) {
                scrollContainer.scrollTop += delta;
              }
            },
          };
        },
      }),
  );
}
