import type { Node as ProseNode } from "@milkdown/kit/prose/model";

/**
 * Above this document size (ProseMirror's node-size, roughly the char count
 * plus one per node boundary - close enough for a threshold check), several
 * per-keystroke editor features degrade to keep typing responsive: ghost
 * text and grammar-check stop triggering, and Mermaid stops live-rendering
 * on every edit. Ordinary documents never get near this, so their behavior
 * is unchanged - see 4.1 in the reliability plan.
 */
export const LARGE_DOC_THRESHOLD = 100_000;

export function isLargeDoc(doc: ProseNode): boolean {
  return doc.content.size > LARGE_DOC_THRESHOLD;
}
