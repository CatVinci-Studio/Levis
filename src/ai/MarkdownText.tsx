import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { normalizeMathDelimiters } from "../utils/markdown-math";

// Chat replies are short-form and conversational - a bare newline should
// break the line like it visually looks, not require a blank line the way
// document-editing markdown does.
marked.setOptions({ gfm: true, breaks: true });

/**
 * Renders an assistant reply as formatted markdown (bold, lists, code,
 * links, ...) instead of a flat text blob. The model's raw output is
 * untrusted (it can be steered by document content or prompt injection), so
 * it's sanitized before going into the DOM via `dangerouslySetInnerHTML`.
 */
export function MarkdownText({ text }: { text: string }) {
  const html = useMemo(() => {
    // Not real math rendering (no KaTeX here) - just keeps LaTeX-delimited
    // formulas from being mangled by markdown's backslash-escaping (`\(`
    // would otherwise lose its backslash and read as a stray paren).
    const parsed = marked.parse(normalizeMathDelimiters(text), { async: false }) as string;
    return DOMPurify.sanitize(parsed);
  }, [text]);

  // eslint-disable-next-line react/no-danger -- sanitized above
  return <div className="agent-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
