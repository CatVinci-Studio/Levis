import type { Transaction } from "@milkdown/kit/prose/state";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";

type QuickAskMeta = { type: "show"; pos: number } | { type: "hide" };

interface QuickAskState {
  pos: number | null;
  decoration: DecorationSet;
}

export const quickAskKey = new PluginKey<QuickAskState>("quick-ask-widget");

/** Shows the panel's widget after document position `pos` (MilkdownEditor,
 *  on open) - or hides it (close, or hide-for-detach). */
export function setQuickAskWidget(
  tr: Transaction,
  pos: number | null,
): Transaction {
  return tr.setMeta(
    quickAskKey,
    pos === null ? { type: "hide" } : { type: "show", pos },
  );
}

/**
 * The Quick Ask panel's place in the document: a block widget decoration
 * right after the top-level block the chat was opened on - VS Code's
 * inline-chat "zone widget" pattern. Being IN the flow means the content
 * below is pushed down rather than covered, and the decoration maps through
 * every edit, so the panel follows its block instead of drifting (the old
 * fixed-position popup's anchor never remapped).
 *
 * The plugin only owns the empty container element; React portals the
 * actual panel into it (MilkdownEditor), the same state-outside /
 * pixels-inside split the chat sidebar experiment used. `stopEvent`
 * keeps ProseMirror's editing machinery out of the panel's inputs -
 * the same trick code-block-language-view relies on for its picker.
 */
export function createQuickAskWidgetPlugin(options: {
  /** Hands React the widget's DOM container; null when it leaves the
   *  document (hide, or the whole decoration set being dropped). */
  onMount: (el: HTMLElement | null) => void;
}) {
  function build(doc: ProseNode, pos: number): DecorationSet {
    return DecorationSet.create(doc, [
      Decoration.widget(
        pos,
        () => {
          const el = document.createElement("div");
          el.className = "quick-ask-anchor";
          el.contentEditable = "false";
          options.onMount(el);
          return el;
        },
        {
          key: "quick-ask",
          side: 1,
          stopEvent: () => true,
          ignoreSelection: true,
          destroy: () => options.onMount(null),
        },
      ),
    ]);
  }

  return $prose(
    () =>
      new Plugin<QuickAskState>({
        key: quickAskKey,
        state: {
          init: (): QuickAskState => ({
            pos: null,
            decoration: DecorationSet.empty,
          }),
          apply(tr, prev): QuickAskState {
            const meta = tr.getMeta(quickAskKey) as QuickAskMeta | undefined;
            if (meta?.type === "show") {
              const pos = Math.min(meta.pos, tr.doc.content.size);
              return { pos, decoration: build(tr.doc, pos) };
            }
            if (meta?.type === "hide") {
              return { pos: null, decoration: DecorationSet.empty };
            }
            if (tr.docChanged && prev.pos !== null) {
              return {
                pos: tr.mapping.map(prev.pos, 1),
                decoration: prev.decoration.map(tr.mapping, tr.doc),
              };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            return quickAskKey.getState(state)?.decoration;
          },
        },
      }),
  );
}
