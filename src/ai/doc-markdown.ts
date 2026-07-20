import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { serializerCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { EditAction } from "./types";

/**
 * The document as MARKDOWN SOURCE, which is the representation every AI edit
 * path works in.
 *
 * The older plain-text view (doc.textBetween) was lossy in a way that
 * silently destroyed formatting: the model was shown "这是 重要 内容" for a
 * document that actually reads "这是 **重要** 内容", so it had no way to know
 * a span was bold, a line was a heading, or a paragraph was a list item -
 * and its reply was then parsed BACK as markdown. Three different
 * representations, none of them equal.
 *
 * Everything here keeps a single one: what the model reads, what an anchor is
 * matched against, and what gets parsed on accept are all the same markdown
 * string. Block boundaries carry the ProseMirror positions alongside, so a
 * markdown-space match still resolves to a real document range without
 * needing a markdown-offset -> ProseMirror-position sourcemap (Milkdown
 * offers none, and maintaining one would be its own moving part).
 */

/** What documentMarkdown joins blocks with - one blank line, as markdown. */
export const BLOCK_SEPARATOR = "\n\n";

/** One top-level block, in both coordinate systems at once. */
export interface MarkdownBlock {
  /** ProseMirror position immediately before the block node. */
  from: number;
  /** ProseMirror position immediately after the block node. */
  to: number;
  /** The block serialized to markdown, without trailing blank lines. */
  markdown: string;
  /** Where this block's markdown starts inside documentMarkdown()'s output. */
  offset: number;
}

/** Markdown source of a ProseMirror range - the selection, a block, a slice. */
export function serializeRange(
  ctx: Ctx,
  doc: ProseNode,
  from: number,
  to: number,
): string {
  return ctx.get(serializerCtx)(doc.cut(from, to)).trimEnd();
}

/**
 * Every top-level block with its markdown and its ProseMirror range. Blocks
 * are serialized one at a time (rather than slicing a whole-document string)
 * so each one's markdown is anchored to an exact node range - that pairing is
 * what lets a markdown-space match land back on a real document position.
 */
export function serializeBlocks(ctx: Ctx, doc: ProseNode): MarkdownBlock[] {
  const serializer = ctx.get(serializerCtx);
  const blocks: MarkdownBlock[] = [];
  let offset = 0;
  doc.forEach((node, pos) => {
    const markdown = serializer(doc.cut(pos, pos + node.nodeSize)).trimEnd();
    blocks.push({ from: pos, to: pos + node.nodeSize, markdown, offset });
    offset += markdown.length + BLOCK_SEPARATOR.length;
  });
  return blocks;
}

/** The whole document as one markdown string - what the model is shown. */
export function documentMarkdown(blocks: MarkdownBlock[]): string {
  return blocks.map((block) => block.markdown).join(BLOCK_SEPARATOR);
}

/**
 * A resolved anchor: the ProseMirror range of the WHOLE blocks the snippet
 * touches, plus the markdown on either side of the snippet within them.
 *
 * The range is snapped outward to block boundaries deliberately. A markdown
 * offset inside a block can't be converted to a ProseMirror position, but a
 * block boundary can - so the edit is composed as text (prefix + new middle +
 * suffix) and applied by re-parsing those whole blocks. Sub-block precision
 * survives in the composed markdown; only the range that gets re-parsed is
 * coarse.
 */
export interface MarkdownMatch {
  from: number;
  to: number;
  /** Markdown between the first touched block's start and the snippet. */
  prefix: string;
  /** Markdown between the snippet's end and the last touched block's end. */
  suffix: string;
  /** Current markdown of the touched blocks - `prefix + snippet + suffix`. */
  markdown: string;
}

function blockIndexAt(blocks: MarkdownBlock[], offset: number): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (offset >= blocks[i].offset) return i;
  }
  return 0;
}

/**
 * Locates `snippet` in the document's markdown. Null when it's absent or
 * occurs more than once - the same "must be quoted verbatim and occur exactly
 * once" contract the backend states in AGENT_TOOL_INSTRUCTIONS, only now
 * evaluated against the markdown the model was actually shown.
 */
export function findMarkdownMatch(
  blocks: MarkdownBlock[],
  snippet: string,
): MarkdownMatch | null {
  if (!snippet || blocks.length === 0) return null;
  const doc = documentMarkdown(blocks);
  const start = doc.indexOf(snippet);
  if (start === -1) return null;
  if (doc.indexOf(snippet, start + 1) !== -1) return null; // ambiguous
  const end = start + snippet.length;

  const startIdx = blockIndexAt(blocks, start);
  // `end` is exclusive, so probe the last character the snippet covers.
  const endIdx = Math.max(startIdx, blockIndexAt(blocks, end - 1));
  const first = blocks[startIdx];
  const last = blocks[endIdx];
  const spanStart = first.offset;
  const spanEnd = last.offset + last.markdown.length;

  return {
    from: first.from,
    to: last.to,
    prefix: doc.slice(spanStart, Math.max(spanStart, start)),
    suffix: doc.slice(Math.min(spanEnd, end), spanEnd),
    markdown: doc.slice(spanStart, spanEnd),
  };
}

/**
 * The markdown those blocks should become - composed in markdown space, so
 * whatever formatting the prefix/suffix carried is preserved verbatim rather
 * than being re-derived from a lossy plain-text round trip.
 */
export function composeMarkdownEdit(
  match: MarkdownMatch,
  action: EditAction,
  snippet: string,
  text: string,
): string {
  let middle: string;
  switch (action) {
    case "delete":
      middle = "";
      break;
    case "insert_before":
      middle = `${text}${BLOCK_SEPARATOR}${snippet}`;
      break;
    case "insert_after":
      middle = `${snippet}${BLOCK_SEPARATOR}${text}`;
      break;
    default:
      middle = text;
      break;
  }
  return `${match.prefix}${middle}${match.suffix}`;
}
