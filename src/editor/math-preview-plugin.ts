import katex from "katex";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

const mathPreviewKey = new PluginKey("math-preview");

function makeDelimiterEl(delimiter: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "math-delimiter";
  span.textContent = delimiter;
  span.contentEditable = "false";
  return span;
}

function renderKatex(value: string, displayMode: boolean): string {
  try {
    return katex.renderToString(value || "\\,", { throwOnError: false, displayMode });
  } catch {
    return value;
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const { selection } = state;
  const decorations: Decoration[] = [];

  state.doc.descendants((node, pos) => {
    if (node.type.name !== "math_inline" && node.type.name !== "math_block") return;

    const from = pos;
    const to = pos + node.nodeSize;
    const cursorInside = selection.from <= to && selection.to >= from;
    const displayMode = node.type.name === "math_block";

    if (cursorInside) {
      // Raw LaTeX source shows through for editing, but the $ / $$ wrapper
      // is markdown syntax, not part of the node's own text - synthesize it
      // so what you see while editing still looks like real markdown.
      const delimiter = displayMode ? "$$" : "$";
      decorations.push(
        Decoration.widget(from + 1, () => makeDelimiterEl(delimiter), { side: -1 }),
      );
      decorations.push(
        Decoration.widget(to - 1, () => makeDelimiterEl(delimiter), { side: 1 }),
      );
      return;
    }

    const html = renderKatex(node.textContent, displayMode);

    decorations.push(Decoration.inline(from + 1, to - 1, { class: "math-source-hidden" }));
    decorations.push(
      Decoration.widget(
        to,
        (view: EditorView, getPos: () => number | undefined) => {
          const el = document.createElement(displayMode ? "div" : "span");
          el.className = displayMode ? "math-block-rendered" : "math-inline-rendered";
          el.innerHTML = html;
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
        { side: 1 },
      ),
    );
  });

  return DecorationSet.create(state.doc, decorations);
}

function findMathNodeAtSelection(
  state: EditorState,
): { node: { type: { name: string }; textContent: string }; from: number } | null {
  const { selection } = state;
  let found: { node: { type: { name: string }; textContent: string }; from: number } | null = null;
  state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name !== "math_inline" && node.type.name !== "math_block") return;
    const from = pos;
    const to = pos + node.nodeSize;
    if (selection.from >= from && selection.to <= to) {
      found = { node, from };
    }
  });
  return found;
}

/**
 * Typora-style math rendering: math_inline/math_block nodes hold plain
 * LaTeX source text (edited like any other text), but whenever the cursor
 * isn't inside one, its source is hidden and a KaTeX-rendered widget is
 * shown in its place. Moving the cursor back in (or clicking the render)
 * reveals the source again. While the cursor IS inside one, a floating
 * live preview follows along above the source so you can see the rendered
 * result while typing it.
 */
export const mathPreviewPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: mathPreviewKey,
      state: {
        init: (_config, state) => buildDecorations(state),
        apply(tr, prev, _oldState, newState) {
          if (!tr.docChanged && !tr.selectionSet) return prev;
          return buildDecorations(newState);
        },
      },
      props: {
        decorations(state) {
          return mathPreviewKey.getState(state);
        },
      },
      view(editorView) {
        const floatEl = document.createElement("div");
        floatEl.className = "math-float-preview";
        floatEl.style.display = "none";
        document.body.appendChild(floatEl);

        function updateFloat(view: EditorView) {
          const found = findMathNodeAtSelection(view.state);
          if (!found) {
            floatEl.style.display = "none";
            return;
          }

          const displayMode = found.node.type.name === "math_block";
          floatEl.innerHTML = renderKatex(found.node.textContent, displayMode);
          floatEl.style.display = "block";

          const coords = view.coordsAtPos(found.from);
          const rect = floatEl.getBoundingClientRect();
          floatEl.style.left = `${Math.max(4, coords.left)}px`;
          floatEl.style.top = `${coords.top - rect.height - 10}px`;
        }

        updateFloat(editorView);

        return {
          update: updateFloat,
          destroy() {
            floatEl.remove();
          },
        };
      },
    }),
);
