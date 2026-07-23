import type { Ctx } from "@milkdown/kit/ctx";
import { parserCtx } from "@milkdown/kit/core";
import { normalizeMathDelimiters } from "../utils/markdown-math";

/** Text -> parsed ProseMirror doc, normalizing `\[ \]`/`\( \)` LaTeX
 *  delimiters to the `$`/`$$` this editor's math schema actually recognizes
 *  first. Shared by every path that turns raw markdown text into real
 *  document content (paste, AI edit apply, clipboard reinsert) so none of
 *  them has to special-case math delimiters on its own. */
export function parseMarkdownSource(ctx: Ctx, text: string) {
  try {
    return ctx.get(parserCtx)(normalizeMathDelimiters(text));
  } catch {
    return null;
  }
}
