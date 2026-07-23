import { useMemo } from "react";
import { renderMarkdownHtml } from "./markdown-render";

/**
 * Renders an assistant reply as formatted markdown (bold, lists, code,
 * links, ...) instead of a flat text blob. The model's raw output is
 * untrusted (it can be steered by document content or prompt injection), so
 * it's sanitized (renderMarkdownHtml) before going into the DOM via
 * `dangerouslySetInnerHTML`.
 */
export function MarkdownText({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdownHtml(text), [text]);

  // Safe at this boundary because the generated HTML is sanitized above.
  return (
    <div
      className="agent-markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
