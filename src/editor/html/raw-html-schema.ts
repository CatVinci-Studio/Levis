import { $nodeSchema } from "@milkdown/kit/utils";

/**
 * Replaces stock Milkdown's `htmlSchema` (excluded in reduced-presets.ts),
 * which models raw HTML as an atom whose toDOM just echoes the tag text
 * back as a string - never real, editable content. This version stores the
 * raw markup as genuine text content (same shape as math_inline/math_block
 * in math-schema.ts) so a cursor can enter it and edit it directly, and so
 * raw-html-preview-plugin.ts can render a whitelist of common tags while the
 * cursor is elsewhere.
 *
 * remarkHtmlTransformer (stock, still active) already rewrites every
 * block-position raw-HTML mdast node into `paragraph > html` before parsing
 * reaches node schemas at all, so there is no separate block-vs-inline case
 * to handle here - every occurrence arrives as this one inline node type.
 */
export const rawHtmlSchema = $nodeSchema("html", () => ({
  content: "text*",
  group: "inline",
  inline: true,
  marks: "",
  // Opaque like frontmatter/math source - typing "*" etc. inside raw HTML
  // shouldn't turn into a bold md_span.
  code: true,
  attrs: {},
  parseDOM: [{ tag: 'span[data-type="html"]', preserveWhitespace: "full" }],
  toDOM: () => ["span", { "data-type": "html", class: "raw-html-source" }, 0],
  parseMarkdown: {
    match: (node) => node.type === "html",
    runner: (state, node, type) => {
      state.openNode(type);
      if (node.value) state.addText(node.value as string);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "html",
    // node.textContent, not content.firstChild?.text - an edit can leave
    // the "text*" content as more than one text node, and only reading the
    // first would silently drop the rest of the markup on save (same
    // reasoning as frontmatter-schema.ts's toMarkdown).
    runner: (state, node) => {
      state.addNode("html", undefined, node.textContent);
    },
  },
}));
