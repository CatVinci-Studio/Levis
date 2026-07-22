import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

type ChatSelectionMeta =
  { type: "set"; from: number; to: number } | { type: "clear" };

interface ChatSelectionState {
  range: { from: number; to: number } | null;
  decoration: DecorationSet;
}

export const chatSelectionKey = new PluginKey<ChatSelectionState>(
  "chat-selection",
);

/** Highlight or clear the chat-context selection - dispatched by
 *  MilkdownEditor whenever `useInlineChat`'s captured range appears or the
 *  chat context is dropped. */
export function setChatSelection(
  tr: Transaction,
  range: { from: number; to: number } | null,
): Transaction {
  const meta: ChatSelectionMeta = range
    ? { type: "set", from: range.from, to: range.to }
    : { type: "clear" };
  return tr.setMeta(chatSelectionKey, meta);
}

const EMPTY: ChatSelectionState = {
  range: null,
  decoration: DecorationSet.empty,
};

function highlighted(state: EditorState, from: number, to: number) {
  if (from >= to || to > state.doc.content.size) return EMPTY;
  return {
    range: { from, to },
    decoration: DecorationSet.create(state.doc, [
      Decoration.inline(from, to, { class: "chat-selection" }),
    ]),
  };
}

/**
 * Keeps the text the inline chat was opened over visibly marked while the
 * chat is up. The native selection paint disappears the moment focus moves
 * to the chat composer, leaving no in-document trace of what "{n} chars
 * selected" refers to - this decoration is that trace. Purely cosmetic: the
 * authoritative range a replace_selection proposal targets stays
 * `chatInfo.range` (useInlineChat.ts), which is captured once and NOT
 * remapped - so on docChanged this highlight survives only while the
 * mapped range still equals the captured one (edits after the selection),
 * and clears the moment positions shift, when the un-remapped
 * `chatInfo.range` no longer points at the selected text and a
 * replace_selection proposal would be rejected as stale anyway.
 */
export const chatSelectionPlugin = $prose(
  () =>
    new Plugin<ChatSelectionState>({
      key: chatSelectionKey,
      state: {
        init: () => EMPTY,
        apply(tr, prev, _old, state): ChatSelectionState {
          const meta = tr.getMeta(chatSelectionKey) as
            ChatSelectionMeta | undefined;
          if (meta?.type === "set")
            return highlighted(state, meta.from, meta.to);
          if (meta?.type === "clear") return EMPTY;
          if (tr.docChanged && prev.range) {
            const from = tr.mapping.map(prev.range.from, 1);
            const to = tr.mapping.map(prev.range.to, -1);
            if (from !== prev.range.from || to !== prev.range.to) return EMPTY;
            return {
              range: prev.range,
              decoration: prev.decoration.map(tr.mapping, tr.doc),
            };
          }
          return prev;
        },
      },
      props: {
        decorations(state) {
          return chatSelectionKey.getState(state)?.decoration;
        },
      },
    }),
);
