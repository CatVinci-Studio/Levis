import { useEffect, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../../editor/useEditorRunner";

/**
 * Screen coordinates of a document position, kept current as the view moves
 * under it.
 *
 * The inline chat used to capture x/y once when it opened and never look
 * again, so scrolling slid the document out from under the popup and left it
 * hovering over unrelated text (or over nothing at all). Recomputing from the
 * position itself keeps the popup attached to the text it was opened on.
 *
 * Scroll is listened for in the CAPTURE phase because scroll events don't
 * bubble - the editor's own scroll container has to be caught on the way
 * down. A MutationObserver on the editor covers content above the anchor
 * changing height (an accepted edit, an image loading).
 *
 * Known limit: `pos` is not remapped through document changes, so accepting
 * an edit ABOVE the anchor shifts the text without shifting the anchor. Doing
 * that properly needs a plugin holding the position through each
 * transaction's mapping (the way pending-edit-plugin does); it is not worth
 * one for a popup the user is typing into rather than editing around.
 */
export function useAnchoredPosition(
  run: EditorRunner,
  pos: number,
): { x: number; y: number } | null {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        run((ctx) => {
          const view = ctx.get(editorViewCtx);
          const clamped = Math.min(pos, view.state.doc.content.size);
          try {
            const rect = view.coordsAtPos(clamped);
            setCoords({ x: rect.left, y: rect.bottom + 6 });
          } catch {
            // Position isn't renderable this tick (mid-remap, or scrolled
            // out of the rendered range) - keep the last known coordinates
            // rather than throwing the popup to 0,0.
          }
        });
      });
    };

    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);

    const root = run((ctx) => ctx.get(editorViewCtx).dom);
    const observer = root ? new MutationObserver(measure) : null;
    if (root && observer)
      observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
      });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [run, pos]);

  return coords;
}
