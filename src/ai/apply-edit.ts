import type { EditorState } from "@milkdown/kit/prose/state";
import type { Ctx } from "@milkdown/kit/ctx";
import { Slice } from "@milkdown/kit/prose/model";
import { parseMarkdownSource } from "../editor/parse-markdown-source";

/**
 * Models routinely bullet lists with typographic dots ("•", "●", "◦", "·")
 * instead of markdown "-" - as plain text those survive the markdown parse
 * and land verbatim in the document. Rewrite them to "-" so lists arrive as
 * lists. Shared by every path that writes an AI reply into the document.
 */
export function normalizeAiMarkdown(text: string): string {
  return text.replace(/^(\s*)[•●◦·]\s+/gm, "$1- ");
}

/**
 * Builds the transaction that replaces `[from, to)` with `rawText`, parsed
 * as markdown so formatted content lands rendered (falling back to a plain
 * text insert if it doesn't parse). The one place every "write an AI reply
 * into the document" flow converges: free-text apply and a propose_edit
 * Apply click (useInlineChat.ts) and accepting an in-document pending edit
 * (usePendingEdits.ts) all build their transaction here, so the three paths
 * can't drift on how markdown gets parsed.
 */
export function applyEditRange(
  state: EditorState,
  ctx: Ctx,
  from: number,
  to: number,
  rawText: string,
) {
  const text = normalizeAiMarkdown(rawText);
  const parsed = parseMarkdownSource(ctx, text);
  return parsed
    ? state.tr.replaceRange(from, to, Slice.maxOpen(parsed.content))
    : state.tr.insertText(text, from, to);
}
