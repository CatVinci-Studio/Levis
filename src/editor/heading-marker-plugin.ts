import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { EditorState } from "@milkdown/kit/prose/state";

const headingMarkerKey = new PluginKey("heading-marker");

function buildDecorations(state: EditorState): DecorationSet {
  const { selection } = state;
  const decorations: Decoration[] = [];

  state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;

    const from = pos;
    const to = pos + node.nodeSize;
    const cursorInside = selection.from <= to && selection.to >= from;
    if (!cursorInside) return;

    const level = (node.attrs.level as number) ?? 1;
    decorations.push(
      Decoration.widget(
        pos + 1,
        () => {
          const span = document.createElement("span");
          span.className = "heading-marker";
          span.textContent = "#".repeat(level) + " ";
          span.contentEditable = "false";
          return span;
        },
        { side: -1 },
      ),
    );
  });

  return DecorationSet.create(state.doc, decorations);
}

/**
 * Typora-style reveal: the "# "/"## " prefix for a heading only shows up
 * while the cursor is on that line, otherwise the heading renders as plain
 * large/bold text with no marker (which is how headings render regardless -
 * this only toggles the prefix, not the heading styling itself).
 */
export const headingMarkerPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: headingMarkerKey,
      state: {
        init: (_config, state) => buildDecorations(state),
        apply(tr, prev, _oldState, newState) {
          if (!tr.docChanged && !tr.selectionSet) return prev;
          return buildDecorations(newState);
        },
      },
      props: {
        decorations(state) {
          return headingMarkerKey.getState(state);
        },
      },
    }),
);
