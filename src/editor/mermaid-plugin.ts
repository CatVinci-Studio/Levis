import mermaid from "mermaid";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

mermaid.initialize({ startOnLoad: false, theme: "neutral" });

const mermaidKey = new PluginKey("mermaid-preview");
const DEBOUNCE_MS = 500;
let renderSeq = 0;

/**
 * Renders a live diagram preview below any fenced code block whose language
 * is "mermaid", as a widget decoration - the code itself stays as normal
 * editable text, this just appends the compiled SVG after it.
 */
export const mermaidPreviewPlugin = $prose(() => {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  return new Plugin<DecorationSet>({
    key: mermaidKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, prev) {
        const meta = tr.getMeta(mermaidKey) as DecorationSet | undefined;
        if (meta) return meta;
        if (tr.docChanged) return prev.map(tr.mapping, tr.doc);
        return prev;
      },
    },
    props: {
      decorations(state) {
        return mermaidKey.getState(state);
      },
    },
    view(editorView) {
      async function renderAll() {
        const mySeq = ++renderSeq;
        const blocks: { pos: number; code: string }[] = [];

        editorView.state.doc.descendants((node, pos) => {
          if (node.type.name === "code_block" && node.attrs.language === "mermaid") {
            blocks.push({ pos: pos + node.nodeSize, code: node.textContent });
          }
        });

        const decorations: Decoration[] = [];
        for (const { pos, code } of blocks) {
          if (!code.trim()) continue;
          try {
            const id = `mermaid-preview-${pos}-${mySeq}`;
            const { svg } = await mermaid.render(id, code);
            if (mySeq !== renderSeq) return; // superseded by a newer render pass
            decorations.push(
              Decoration.widget(
                pos,
                () => {
                  const container = document.createElement("div");
                  container.className = "mermaid-preview";
                  container.innerHTML = svg;
                  return container;
                },
                { side: 1, key: `mermaid-${pos}` },
              ),
            );
          } catch {
            // invalid/incomplete diagram syntax mid-typing - just skip this block
          }
        }

        if (mySeq !== renderSeq) return;
        editorView.dispatch(
          editorView.state.tr.setMeta(mermaidKey, DecorationSet.create(editorView.state.doc, decorations)),
        );
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
