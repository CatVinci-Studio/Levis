import { $nodeSchema, $remark } from "@milkdown/kit/utils";
import type { RemarkPluginRaw } from "@milkdown/kit/transformer";
import { highlightFromMarkdown, highlightSyntax, highlightToMarkdown } from "./highlight-syntax";

// Registers "==highlighted==" parsing/serialization with remark, the same
// way remark-math registers "$...$" (see math-schema.ts) - a unified plugin
// that pushes a micromark syntax extension plus mdast fromMarkdown/
// toMarkdown extensions onto the processor's shared `data()` bag.
const remarkHighlight: RemarkPluginRaw<unknown> = function (this: { data: () => Record<string, unknown[]> }) {
  const data = this.data();
  const micromarkExtensions = (data.micromarkExtensions ??= []);
  const fromMarkdownExtensions = (data.fromMarkdownExtensions ??= []);
  const toMarkdownExtensions = (data.toMarkdownExtensions ??= []);
  micromarkExtensions.push(highlightSyntax());
  fromMarkdownExtensions.push(highlightFromMarkdown());
  toMarkdownExtensions.push(highlightToMarkdown());
} as unknown as RemarkPluginRaw<unknown>;

export const remarkHighlightPlugin = $remark("remark-highlight", () => remarkHighlight);

// The literal markdown delimiter text a node renders from/reverts to -
// shared by the schema's toDOM (static "data-syntax" attribute) and
// enclosure.ts (delimiter reveal widgets, delimiter deletion/unwrap).
export function spanDelimText(node: { type: { name: string }; attrs: { delim?: string; rung?: number } }): string {
  if (node.type.name === "md_code_span") return "`";
  return (node.attrs.delim ?? "*").repeat(node.attrs.rung ?? 1);
}

// One node type covers bold/italic/bold+italic/strikethrough/highlight -
// they're all "wrap some inline content in a repeated delimiter", differing
// only in which character and how many of them. `delim`+`rung` together
// pick the rendered style and the markdown wrapper on save (see toMarkdown
// below); `rung` only ever varies for "*" (1 = italic, 2 = bold, 3 = both) -
// "~" and "=" are always rung 2, there's no single-character form for either.
export const mdSpanSchema = $nodeSchema("md_span", () => ({
  content: "inline*",
  group: "inline",
  inline: true,
  attrs: {
    delim: { default: "*" },
    rung: { default: 1 },
  },
  parseDOM: [
    {
      tag: 'span[data-type="md_span"]',
      getAttrs: (dom) => ({
        delim: (dom as HTMLElement).dataset.delim || "*",
        rung: Number((dom as HTMLElement).dataset.rung) || 1,
      }),
    },
  ],
  toDOM: (node) => [
    "span",
    {
      "data-type": "md_span",
      "data-delim": node.attrs.delim,
      "data-rung": String(node.attrs.rung),
      "data-syntax": spanDelimText(node),
      class: "md-span",
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === "strong" || node.type === "emphasis" || node.type === "delete" || node.type === "mark",
    runner: (state, node, type) => {
      const attrs =
        node.type === "strong"
          ? { delim: "*", rung: 2 }
          : node.type === "emphasis"
            ? { delim: "*", rung: 1 }
            : node.type === "delete"
              ? { delim: "~", rung: 2 }
              : { delim: "=", rung: 2 };
      state.openNode(type, attrs);
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "md_span",
    runner: (state, node) => {
      const delim = node.attrs.delim as string;
      const rung = node.attrs.rung as number;
      if (delim === "*" && rung === 3) {
        // Bold+italic together: mdast represents this as nested strong>emphasis,
        // not a single node - matches how remark itself parses "***text***".
        state.openNode("strong").openNode("emphasis").next(node.content).closeNode().closeNode();
        return;
      }
      const mdastType = delim === "*" ? (rung === 2 ? "strong" : "emphasis") : delim === "~" ? "delete" : "mark";
      state.openNode(mdastType).next(node.content).closeNode();
    },
  },
}));

// Inline code is kept as its own, separate node type (rather than another
// md_span rung) because its content must never contain nested formatting -
// backtick spans are verbatim text, matching how the stock inlineCode mark
// and math_inline both already treat their content as plain, unmarked text.
export const mdCodeSpanSchema = $nodeSchema("md_code_span", () => ({
  content: "text*",
  group: "inline",
  inline: true,
  marks: "",
  code: true,
  attrs: {},
  parseDOM: [{ tag: 'code[data-type="md_code_span"]' }],
  toDOM: () => ["code", { "data-type": "md_code_span", "data-syntax": "`", class: "md-code-span" }, 0],
  parseMarkdown: {
    match: (node) => node.type === "inlineCode",
    runner: (state, node, type) => {
      state.openNode(type);
      if (node.value) state.addText(node.value as string);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "md_code_span",
    runner: (state, node) => {
      state.addNode("inlineCode", undefined, node.content.firstChild?.text || "");
    },
  },
}));
