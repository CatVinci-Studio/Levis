import mermaid from "mermaid";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { cursorTouches } from "./enclosure";

mermaid.initialize({ startOnLoad: false, theme: "neutral" });

const mermaidKey = new PluginKey("mermaid-preview");
const DEBOUNCE_MS = 500;
let renderSeq = 0;

interface MermaidBlock {
  from: number;
  to: number;
  code: string;
}

function collectMermaidBlocks(doc: EditorState["doc"]): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "code_block" && node.attrs.language === "mermaid") {
      blocks.push({ from: pos, to: pos + node.nodeSize, code: node.textContent });
    }
  });
  return blocks;
}

/**
 * Renders a live diagram preview below any fenced code block whose language
 * is "mermaid", as a widget decoration. While the cursor is away from a
 * successfully-rendered block, its raw fenced source is hidden (mirroring
 * math-preview-plugin's source/render swap) so only the diagram shows;
 * moving the cursor back into the block - or clicking the diagram - reveals
 * the source again for editing.
 */
export function createMermaidPreviewPlugin(options: { enabled: () => boolean }) {
  return $prose(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    // Keyed by the block's exact source text rather than its doc position -
    // an edit anywhere earlier in the document shifts every later block's
    // position on every keystroke, which would otherwise miss this cache
    // (position-keyed) on every one of those keystrokes and flash the raw
    // source back until the next debounced render, even though the diagram
    // itself never changed.
    let lastRenders = new Map<string, string>();

    function buildDecorations(state: EditorState): DecorationSet {
      if (!options.enabled()) return DecorationSet.empty;

      const decorations: Decoration[] = [];
      for (const { from, to, code } of collectMermaidBlocks(state.doc)) {
        const svg = lastRenders.get(code);
        if (!svg) continue;
        if (cursorTouches(state.selection, from, to)) continue; // editing it - keep source visible

        decorations.push(Decoration.node(from, to, { class: "mermaid-source-hidden" }));
        decorations.push(
          Decoration.widget(
            to,
            (view: EditorView) => {
              const container = document.createElement("div");
              container.className = "mermaid-preview";
              container.innerHTML = svg;
              container.addEventListener("mousedown", (event) => {
                event.preventDefault();
                const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, from + 1));
                view.dispatch(tr);
                view.focus();
              });
              return container;
            },
            { side: 1, key: `mermaid-${from}` },
          ),
        );
      }
      return DecorationSet.create(state.doc, decorations);
    }

    return new Plugin<DecorationSet>({
      key: mermaidKey,
      state: {
        init: (_config, state) => buildDecorations(state),
        apply(tr, prev, _oldState, newState) {
          const meta = tr.getMeta(mermaidKey) as "rerender" | undefined;
          if (!meta && !tr.docChanged && !tr.selectionSet) return prev;
          return buildDecorations(newState);
        },
      },
      props: {
        decorations(state) {
          return mermaidKey.getState(state);
        },
      },
      view(editorView) {
        async function renderAll() {
          if (!options.enabled()) {
            lastRenders = new Map();
            editorView.dispatch(editorView.state.tr.setMeta(mermaidKey, "rerender"));
            return;
          }

          const mySeq = ++renderSeq;
          const blocks = collectMermaidBlocks(editorView.state.doc);

          const rendered = new Map<string, string>();
          for (const { code } of blocks) {
            if (!code.trim() || rendered.has(code)) continue; // identical diagrams share one render
            try {
              const id = `mermaid-preview-${mySeq}-${rendered.size}`;
              const { svg } = await mermaid.render(id, code);
              if (mySeq !== renderSeq) return; // superseded by a newer render pass
              rendered.set(code, svg);
            } catch {
              // invalid/incomplete diagram syntax mid-typing - just skip this block
            }
          }

          if (mySeq !== renderSeq) return;
          lastRenders = rendered;
          editorView.dispatch(editorView.state.tr.setMeta(mermaidKey, "rerender"));
        }

        renderAll();

        return {
          update(view, prevState) {
            if (view.state.doc.eq(prevState.doc)) return;
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(renderAll, DEBOUNCE_MS);
          },
          destroy() {
            if (debounceTimer) clearTimeout(debounceTimer);
          },
        };
      },
    });
  });
}
