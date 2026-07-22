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

/** Byte offset of `needle`'s single occurrence in `doc`, null when absent
 *  or repeated - an ambiguous match can't be trusted to be the one meant. */
function uniqueIndexOf(doc: string, needle: string): number | null {
  const first = doc.indexOf(needle);
  if (first === -1 || doc.indexOf(needle, first + 1) !== -1) return null;
  return first;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whitespace-tolerant retry for a snippet with NO verbatim occurrence at
 * all: models routinely fold the blank line between blocks into a single
 * newline (or a space) when quoting. Word-ish runs must still match
 * verbatim and the whole thing must still occur exactly once, so this
 * can't land an edit anywhere an exact quote couldn't have.
 */
function flexibleRange(
  doc: string,
  snippet: string,
): { start: number; end: number } | null {
  const tokens = snippet.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null; // single token: flexible == exact
  const pattern = new RegExp(tokens.map(escapeRegExp).join("\\s+"), "g");
  const first = pattern.exec(doc);
  if (!first || pattern.exec(doc)) return null;
  return { start: first.index, end: first.index + first[0].length };
}

/**
 * Locates `snippet` in the document's markdown. Null when it's absent or
 * occurs more than once - the same "must be quoted verbatim and occur exactly
 * once" contract the backend states in AGENT_TOOL_INSTRUCTIONS, only now
 * evaluated against the markdown the model was actually shown.
 *
 * Two escape hatches keep honest proposals from dying on that contract
 * (both mirrored in the backend's propose_edit validation, tools.rs):
 * `context` - a longer verbatim quote containing the snippet, itself
 * unique - pins down WHICH occurrence a repeated snippet means, and a
 * whitespace-tolerant retry catches quotes whose only defect is a folded
 * blank line. Anything still unresolved stays null; there is deliberately
 * no fuzzier fallback than whitespace.
 */
export function findMarkdownMatch(
  blocks: MarkdownBlock[],
  snippet: string,
  context?: string,
): MarkdownMatch | null {
  if (!snippet || blocks.length === 0) return null;
  const doc = documentMarkdown(blocks);

  let range: { start: number; end: number } | null = null;
  const exact = uniqueIndexOf(doc, snippet);
  if (exact !== null) range = { start: exact, end: exact + snippet.length };
  if (!range && context && context.length > snippet.length) {
    const inner = context.indexOf(snippet);
    const contextStart = inner === -1 ? null : uniqueIndexOf(doc, context);
    if (contextStart !== null) {
      const start = contextStart + inner;
      range = { start, end: start + snippet.length };
    }
  }
  if (!range && doc.indexOf(snippet) === -1) {
    range = flexibleRange(doc, snippet);
  }
  if (!range) return null;
  const { start, end } = range;

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
 *
 * The kept text for insert actions is sliced out of the DOCUMENT's markdown
 * (what the match actually covered), not taken from the model's quote - a
 * whitespace-tolerant match means the two can differ, and the model's
 * version must never reformat what it was only inserting next to.
 */
export function composeMarkdownEdit(
  match: MarkdownMatch,
  action: EditAction,
  text: string,
): string {
  const matched = match.markdown.slice(
    match.prefix.length,
    match.markdown.length - match.suffix.length,
  );
  let middle: string;
  switch (action) {
    case "delete":
      middle = "";
      break;
    case "insert_before":
      middle = `${text}${BLOCK_SEPARATOR}${matched}`;
      break;
    case "insert_after":
      middle = `${matched}${BLOCK_SEPARATOR}${text}`;
      break;
    default:
      middle = text;
      break;
  }
  return `${match.prefix}${middle}${match.suffix}`;
}
