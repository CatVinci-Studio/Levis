import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/** Room kept between the caret's line and the bottom of what shows. */
const MARGIN = 12;

/** Scrolls `view`'s caret up into its scroll container if the container's
 *  bottom has come down over it. Never down, and never centred: the line
 *  only has to be visible. */
export function revealCaret(view: EditorView) {
  const container = view.dom.closest(".editor-scroll");
  if (!container || view.dom.offsetParent === null) return;
  let coords: { bottom: number };
  try {
    coords = view.coordsAtPos(view.state.selection.head);
  } catch {
    return;
  }
  const bottom = container.getBoundingClientRect().bottom - MARGIN;
  if (coords.bottom > bottom) container.scrollTop += coords.bottom - bottom;
}

/**
 * On a phone the keyboard comes up after the tap that put the caret in the
 * text: the web view shortens (KeyboardFit.swift) and a caret in the lower
 * half is left behind the keyboard - WebKit's own scroll-to-the-caret is
 * what KeyboardFit turns off, as it carried the whole page, title row and
 * all, off the top. So when the window gets shorter while the editor has
 * the focus, its caret is brought back into view: once at the resize and
 * once more after the keyboard's animation, whichever size WebKit reports
 * on the way.
 */
export const keyboardRevealPlugin = $prose(
  () =>
    new Plugin({
      view(editorView) {
        let height = window.innerHeight;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onResize = () => {
          const shorter = window.innerHeight < height;
          height = window.innerHeight;
          if (!shorter || !editorView.hasFocus() || editorView.composing)
            return;
          requestAnimationFrame(() => revealCaret(editorView));
          clearTimeout(timer);
          timer = setTimeout(() => revealCaret(editorView), 350);
        };
        window.addEventListener("resize", onResize);
        return {
          destroy() {
            clearTimeout(timer);
            window.removeEventListener("resize", onResize);
          },
        };
      },
    }),
);
