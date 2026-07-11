import { $nodeSchema, $remark } from "@milkdown/kit/utils";
import remarkFrontmatter from "remark-frontmatter";

/**
 * Recognizes a leading "---\n...\n---" block as a single yaml frontmatter
 * mdast node instead of letting commonmark misparse it as a setext heading
 * (a bare "---" line right after text turns the preceding paragraph into an
 * h2). remark-frontmatter's own syntax extension only matches at the very
 * start of the document, so no extra positional enforcement is needed here.
 */
// The explicit "yaml" preset matters: $remark defaults omitted options to
// {}, which remark-frontmatter reads as a matter definition and throws
// "Missing `type` in matter" on every parse - blanking the whole editor.
export const remarkFrontmatterPlugin = $remark("remark-frontmatter", () => remarkFrontmatter, "yaml");

/**
 * Deliberately plain: raw text content, no language selector or collapse
 * toggle (unlike code-block-language-view.ts / mermaid-plugin.ts) - just a
 * visually distinct box via CSS (see .frontmatter-block in
 * milkdown-theme.css) so it doesn't get mistaken for document body text.
 */
export const frontmatterSchema = $nodeSchema("frontmatter", () => ({
  content: "text*",
  group: "block",
  marks: "",
  code: true,
  defining: true,
  isolating: true,
  attrs: {},
  parseDOM: [{ tag: 'div[data-type="frontmatter"]', preserveWhitespace: "full" }],
  toDOM: () => ["div", { "data-type": "frontmatter", class: "frontmatter-block" }, 0],
  parseMarkdown: {
    match: (node) => node.type === "yaml",
    runner: (state, node, type) => {
      state.openNode(type);
      if (node.value) state.addText(node.value as string);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "frontmatter",
    runner: (state, node) => {
      // node.textContent (not content.firstChild?.text) - a paste or edit
      // can leave the "text*" content as more than one text node, and only
      // reading the first would silently drop the rest of the YAML on save.
      state.addNode("yaml", undefined, node.textContent);
    },
  },
}));
