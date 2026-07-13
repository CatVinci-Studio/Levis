import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { cursorTouches } from "./enclosure";
import { renderWhitelistedHtml } from "./raw-html-sanitize";

const rawHtmlPreviewKey = new PluginKey("raw-html-preview");

function buildDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];

  state.doc.descendants((node, pos) => {
    if (node.type.name !== "html") return;

    const from = pos;
    const to = pos + node.nodeSize;
    // While the cursor touches the node, the raw markup shows as plain,
    // directly editable text - same predicate as math-preview-plugin.ts, so
    // the two never disagree about what "editing" means for a node type.
    if (cursorTouches(state.selection, from, to)) return;

    const rendered = renderWhitelistedHtml(node.textContent);
    // Not a whitelisted tag (or unparsable) - leave the raw text visible,
    // today's existing fallback for anything outside the whitelist.
    if (rendered === null) return;

    decorations.push(Decoration.inline(from + 1, to - 1, { class: "raw-html-source-hidden" }));
    decorations.push(
      Decoration.widget(
        to,
        (view: EditorView, getPos: () => number | undefined) => {
          const el = document.createElement("div");
          el.className = "raw-html-rendered";
          el.innerHTML = rendered;
          el.addEventListener("mousedown", (event) => {
            event.preventDefault();
            const widgetPos = getPos();
            if (typeof widgetPos !== "number") return;
            const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, widgetPos - 1));
            view.dispatch(tr);
            view.focus();
          });
          return el;
        },
        { side: -1 },
      ),
    );
  });

  return DecorationSet.create(state.doc, decorations);
}

/**
 * Raw-HTML counterpart to math-preview-plugin.ts: while the cursor is away
 * from a whitelisted-renderable `html` node, its raw markup is hidden and a
 * sanitized rendering shown in its place (clicking it puts the cursor back
 * inside for direct editing); while the cursor touches one, the raw source
 * shows through untouched.
 */
export function createRawHtmlPreviewPlugin() {
  return $prose(
    () =>
      new Plugin<DecorationSet>({
        key: rawHtmlPreviewKey,
        state: {
          init: (_config, state) => buildDecorations(state),
          apply(tr, prev, _oldState, newState) {
            if (!tr.docChanged && !tr.selectionSet) return prev;
            return buildDecorations(newState);
          },
        },
        props: {
          decorations(state) {
            return rawHtmlPreviewKey.getState(state);
          },
        },
      }),
  );
}
