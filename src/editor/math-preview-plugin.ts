import katex from "katex";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  applyReveal,
  buildReveal,
  emptyReveal,
  type RevealState,
} from "./reveal-state";

const mathPreviewKey = new PluginKey("math-preview");

// Decorations are rebuilt on every transaction - each keystroke and each
// arrow press - and used to re-run KaTeX on every formula in the document
// each time. Renders are pure in (source, mode), so they are cached; the
// cap only bounds a session that types through thousands of formulas.
const RENDER_CACHE_LIMIT = 1000;
const renderCache = new Map<string, string>();

function renderKatex(value: string, displayMode: boolean): string {
  const cacheKey = `${displayMode ? "B" : "I"}${value}`;
  const cached = renderCache.get(cacheKey);
  if (cached !== undefined) return cached;
  let html: string;
  try {
    html = katex.renderToString(value || "\\,", {
      throwOnError: false,
      displayMode,
    });
  } catch {
    html = value;
  }
  if (renderCache.size >= RENDER_CACHE_LIMIT) renderCache.clear();
  renderCache.set(cacheKey, html);
  return html;
}

function buildDecorations(state: EditorState, enabled: boolean): RevealState {
  if (!enabled) return emptyReveal;
  return buildReveal(state, (touches) => collectDecorations(state, touches));
}

function collectDecorations(
  state: EditorState,
  touches: (from: number, to: number) => boolean,
): Decoration[] {
  const decorations: Decoration[] = [];

  state.doc.descendants((node, pos) => {
    if (node.type.name !== "math_inline" && node.type.name !== "math_block")
      return;

    const from = pos;
    const to = pos + node.nodeSize;
    // While the cursor touches the node (inside or adjacent), enclosure.ts
    // reveals the raw source with its synthesized $ / $$ delimiters - the
    // KaTeX swap below must stay out of the way for exactly that range, so
    // both sides share the same predicate.
    if (touches(from, to)) return;

    const displayMode = node.type.name === "math_block";
    const html = renderKatex(node.textContent, displayMode);

    decorations.push(
      Decoration.inline(from + 1, to - 1, { class: "math-source-hidden" }),
    );
    decorations.push(
      Decoration.widget(
        to,
        (view: EditorView, getPos: () => number | undefined) => {
          const el = document.createElement(displayMode ? "div" : "span");
          el.className = displayMode
            ? "math-block-rendered"
            : "math-inline-rendered";
          el.innerHTML = html;
          el.addEventListener("mousedown", (event) => {
            event.preventDefault();
            const widgetPos = getPos();
            if (typeof widgetPos !== "number") return;
            const tr = view.state.tr.setSelection(
              TextSelection.create(view.state.doc, widgetPos - 1),
            );
            view.dispatch(tr);
            view.focus();
          });
          return el;
        },
        // Keyed by the source, so ProseMirror keeps the rendered element
        // across transactions instead of rebuilding every formula's DOM on
        // every keystroke - and still replaces it when the source changes.
        {
          side: -1,
          key: `math:${displayMode ? "B" : "I"}:${node.textContent}`,
        },
      ),
    );
  });

  return decorations;
}

function findMathNodeAtSelection(state: EditorState): {
  node: { type: { name: string }; textContent: string };
  from: number;
} | null {
  const { selection } = state;
  let found: {
    node: { type: { name: string }; textContent: string };
    from: number;
  } | null = null;
  // Only nodes the selection lies in can contain it.
  state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (found) return false;
    if (node.type.name !== "math_inline" && node.type.name !== "math_block")
      return;
    // Content bounds, not the node's outer bounds - the floating preview
    // should only follow while actually editing the source, not while
    // merely adjacent to it.
    const from = pos + 1;
    const to = pos + node.nodeSize - 1;
    if (selection.from >= from && selection.to <= to) {
      found = { node, from: pos };
    }
  });
  return found;
}

/**
 * Math-specific extras on top of the shared enclosure model (see
 * enclosure.ts, which owns delimiter reveal and all cursor/key behavior):
 * while the cursor is away from a math node, its raw LaTeX source is hidden
 * and a KaTeX-rendered widget shown in its place (clicking the render puts
 * the cursor back inside); while the cursor is inside one, a floating live
 * preview follows along below the cursor so you can see the rendered result
 * while typing it.
 */
export function createMathPreviewPlugin(options: { enabled: () => boolean }) {
  return $prose(
    () =>
      new Plugin<RevealState>({
        key: mathPreviewKey,
        state: {
          init: (_config, state) => buildDecorations(state, options.enabled()),
          apply: (tr, prev, oldState, newState) =>
            applyReveal(tr, prev, oldState, newState, (state) =>
              buildDecorations(state, options.enabled()),
            ),
        },
        props: {
          decorations(state) {
            return mathPreviewKey.getState(state)?.set;
          },
        },
        view(editorView) {
          const floatEl = document.createElement("div");
          floatEl.className = "math-float-preview";
          floatEl.style.display = "none";
          document.body.appendChild(floatEl);

          // The preview APPEARS on a short delay and hides immediately.
          // The selection can pass through a math node for a single update
          // without the user ever being "in" it - WKWebView caret
          // normalization around the delimiter widgets, autopair
          // conversions, fast arrowing - and an undebounced show makes the
          // box flash for a frame each time. While already visible, updates
          // (typing inside the formula) stay synchronous.
          let showTimer: number | null = null;
          const cancelShow = () => {
            if (showTimer !== null) {
              window.clearTimeout(showTimer);
              showTimer = null;
            }
          };

          function updateFloat(view: EditorView, fromTimer = false) {
            if (!options.enabled()) {
              cancelShow();
              floatEl.style.display = "none";
              return;
            }
            const found = findMathNodeAtSelection(view.state);
            // Nothing to preview until there's actual source - an empty
            // shell would show a bare floating box.
            if (!found || !found.node.textContent.trim()) {
              cancelShow();
              floatEl.style.display = "none";
              return;
            }
            if (floatEl.style.display === "none" && !fromTimer) {
              if (showTimer === null) {
                showTimer = window.setTimeout(() => {
                  showTimer = null;
                  updateFloat(view, true);
                }, 150);
              }
              return;
            }

            const displayMode = found.node.type.name === "math_block";
            floatEl.innerHTML = renderKatex(
              found.node.textContent,
              displayMode,
            );
            floatEl.style.display = "block";

            // Anchored below the cursor's current line (not the node's
            // start), so it tracks along as you type a multi-line block, and
            // matches how every other popup in this app (grammar fixes,
            // inline chat) appears below rather than above. Then clamped to
            // the viewport: pulled back from the right edge, and flipped
            // above the cursor when it would run off the bottom.
            const coords = view.coordsAtPos(view.state.selection.from);
            floatEl.style.left = `${Math.max(4, coords.left)}px`;
            floatEl.style.top = `${coords.bottom + 10}px`;
            const rect = floatEl.getBoundingClientRect();
            if (rect.right > window.innerWidth - 8) {
              floatEl.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
            }
            if (rect.bottom > window.innerHeight - 8) {
              floatEl.style.top = `${Math.max(8, coords.top - rect.height - 10)}px`;
            }
          }

          updateFloat(editorView);

          return {
            // Wrapped: the view-update callback's second argument is
            // prevState, which must not land in updateFloat's fromTimer.
            update: (view) => updateFloat(view),
            destroy() {
              cancelShow();
              floatEl.remove();
            },
          };
        },
      }),
  );
}
