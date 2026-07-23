import { marked } from "marked";
import DOMPurify from "dompurify";
import { normalizeMathDelimiters } from "../utils/markdown-math";

// Short-form/conversational content (chat replies, in-document edit
// previews) - a bare newline should break the line like it visually looks,
// not require a blank line the way document-editing markdown does.
marked.setOptions({ gfm: true, breaks: true });

/**
 * Markdown source -> sanitized HTML, block-aware (paragraphs, lists,
 * headings all become their own elements). For content that renders into a
 * genuine block-level container - the chat reply bubble (MarkdownText.tsx).
 */
export function renderMarkdownHtml(markdown: string): string {
  // Not real math rendering (no KaTeX here) - just keeps LaTeX-delimited
  // formulas from being mangled by markdown's backslash-escaping (`\(`
  // would otherwise lose its backslash and read as a stray paren).
  const parsed = marked.parse(normalizeMathDelimiters(markdown), {
    async: false,
  }) as string;
  return DOMPurify.sanitize(parsed);
}

/**
 * Markdown source -> sanitized HTML, INLINE only (no wrapping `<p>`/`<ul>`/
 * heading elements - bold/italic/code/links stay inline, paragraph breaks
 * fold to line breaks via `breaks: true`). For content that renders inside
 * an inline decoration widget (pending-edit-plugin.ts's green insert
 * widget), where a real block element would be invalid HTML nested inside
 * the surrounding paragraph's inline content.
 */
export function renderMarkdownInlineHtml(markdown: string): string {
  const parsed = marked.parseInline(normalizeMathDelimiters(markdown), {
    async: false,
  }) as string;
  return DOMPurify.sanitize(parsed);
}
