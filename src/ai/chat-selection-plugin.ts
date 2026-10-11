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

const chatSelectionKey = new PluginKey<ChatSelectionState>("chat-selection");

/** The highlighted range as it reads now - mapped through every edit since
 *  it was set. What Quick Ask resolves its captured selection to at send. */
export function chatSelectionRange(
  state: EditorState,
): { from: number; to: number } | null {
  return chatSelectionKey.getState(state)?.range ?? null;
}

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
 * selected" refers to - this decoration is that trace. Its range is also
 * the live one: mapped through every edit, it is what useInlineChat's
 * sendContext resolves the captured selection to before each send.
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
            // Outward bias at both ends: when the range itself is replaced
            // (an accepted rewrite of the selection), it grows to cover the
            // replacement instead of collapsing to a point.
            const from = tr.mapping.map(prev.range.from, -1);
            const to = tr.mapping.map(prev.range.to, 1);
            if (from >= to) return EMPTY;
            return highlighted(state, from, to);
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
