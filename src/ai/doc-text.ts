import type { Node as ProseNode } from "@milkdown/kit/prose/model";

/**
 * AI features exchange PLAIN TEXT with the model (a paragraph's textContent,
 * a quoted snippet), but document positions also count node boundaries - a
 * bold span or inline formula shifts everything after it by 2. These helpers
 * translate between the two, walking text leaves so the mapping stays exact
 * no matter what inline nodes the text passes through.
 */

/** Document position of the `offset`-th character of `parent`'s textContent. */
export function textOffsetToDocPos(parent: ProseNode, contentStart: number, offset: number): number | null {
  let seen = 0;
  let result: number | null = null;
  parent.descendants((node, pos) => {
    if (result !== null) return false;
    if (!node.isText) return true;
    const len = node.text?.length ?? 0;
    if (offset <= seen + len) {
      result = contentStart + pos + (offset - seen);
      return false;
    }
    seen += len;
    return true;
  });
  return result;
}

/**
 * The document range of the single occurrence of `snippet` - matched within
 * one textblock, the same plain-text view of the document the model was
 * shown. Null when the snippet is absent, ambiguous (multiple matches), or
 * spans a block boundary.
 */
export function findUniqueTextRange(doc: ProseNode, snippet: string): { from: number; to: number } | null {
  if (!snippet) return null;
  let hit: { from: number; to: number } | null = null;
  let count = 0;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textContent;
    let idx = text.indexOf(snippet);
    while (idx !== -1) {
      count++;
      if (count === 1) {
        const from = textOffsetToDocPos(node, pos + 1, idx);
        const to = textOffsetToDocPos(node, pos + 1, idx + snippet.length);
        if (from !== null && to !== null) hit = { from, to };
      }
      idx = text.indexOf(snippet, idx + 1);
    }
    return false; // textblock children are inline - nothing more to visit
  });
  return count === 1 ? hit : null;
}
