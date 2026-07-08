import { $nodeSchema, $remark, $inputRule } from "@milkdown/kit/utils";
import { InputRule, textblockTypeInputRule } from "@milkdown/kit/prose/inputrules";
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

// Typing "$formula$" converts it to an inline math node as soon as the
// closing $ is typed.
export const mathInlineInputRule = $inputRule(
  (ctx) =>
    new InputRule(/(?<!\$)\$([^$\s](?:[^$]*[^$\s])?)\$$/, (state, match, start, end) => {
      const value = match[1];
      if (!value) return null;
      const type = mathInlineSchema.type(ctx);
      return state.tr.replaceWith(start, end, type.create({}, state.schema.text(value)));
    }),
);

// Typing "$$" then space/enter at the start of a line creates an empty
// math_block, cursor inside it - mirrors how ``` creates a code block.
export const mathBlockInputRule = $inputRule((ctx) =>
  textblockTypeInputRule(/^\$\$[\s\n]$/, mathBlockSchema.type(ctx)),
);
