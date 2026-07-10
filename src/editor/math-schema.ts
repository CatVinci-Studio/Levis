import { $nodeSchema, $remark, $inputRule } from "@milkdown/kit/utils";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import remarkMath from "remark-math";

export const remarkMathPlugin = $remark("remark-math", () => remarkMath);

export const mathInlineSchema = $nodeSchema("math_inline", () => ({
  content: "text*",
  group: "inline",
  inline: true,
  marks: "",
  attrs: {},
  parseDOM: [{ tag: 'span[data-type="math_inline"]' }],
  toDOM: () => ["span", { "data-type": "math_inline", class: "math-inline" }, 0],
  parseMarkdown: {
    match: (node) => node.type === "inlineMath",
    runner: (state, node, type) => {
      state.openNode(type);
      if (node.value) state.addText(node.value as string);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "math_inline",
    runner: (state, node) => {
      state.addNode("inlineMath", undefined, node.content.firstChild?.text || "");
    },
  },
}));

export const mathBlockSchema = $nodeSchema("math_block", () => ({
  content: "text*",
  group: "block",
  marks: "",
  code: true,
  defining: true,
  attrs: {},
  parseDOM: [{ tag: 'div[data-type="math_block"]', preserveWhitespace: "full" }],
  toDOM: () => ["div", { "data-type": "math_block", class: "math-block" }, 0],
  parseMarkdown: {
    match: (node) => node.type === "math",
    runner: (state, node, type) => {
      state.openNode(type);
      if (node.value) state.addText(node.value as string);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "math_block",
    runner: (state, node) => {
      state.addNode("math", undefined, node.content.firstChild?.text || "");
    },
  },
}));

// Fallback for "$formula$" arriving as a single bulk insertion (e.g. paste)
// rather than character-by-character typing - the normal typing path is
// math-autopair-plugin's "$" auto-pairing, which handles closing a pair one
// keystroke at a time and never reaches this rule.
export const mathInlineInputRule = $inputRule(
  (ctx) =>
    new InputRule(/(?<!\$)\$([^$\s](?:[^$]*[^$\s])?)\$$/, (state, match, start, end) => {
      const value = match[1];
      if (!value) return null;
      const type = mathInlineSchema.type(ctx);
      return state.tr.replaceWith(start, end, type.create({}, state.schema.text(value)));
    }),
);

