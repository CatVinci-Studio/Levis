import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";

// Attributes included (e.g. Word/Notion/Google Docs paste tends to emit
// `<br clear="all">`) - a bare `<br>`/`<br/>` with no attributes never even
// reaches here, since Milkdown's own remark-preserve-empty-line plugin
// (its "blank line" placeholder mechanism) already strips those from the
// tree unconditionally; only the attributed form survives as a real node.
const BR_RE = /^<br(\s[^<>]*)?\/?>$/i;

// GFM tables can't hold a real hardbreak - Milkdown's own
// hardbreakFilterPlugin blocks Shift-Enter inside "table"/"code_block", and
// mdast-util-to-markdown's hardBreak serializer degrades to a single space
// there anyway - so `<br>` is the only way to represent a line break inside
// a table cell. Leave those alone; only paragraphs (typed or pasted <br>)
// get normalized.
const TABLE_CELL_TYPES = new Set(["table_cell", "table_header"]);

/**
 * A lone `<br>`/`<br/>`/`<br />` raw-HTML node (see raw-html-schema.ts) sitting
 * outside a table is really just a line break - normalize it to a genuine
 * hardbreak node so it round-trips as a proper markdown break (backslash +
 * newline) instead of literal `<br/>` text surviving in the saved file.
 */
export const brToHardbreakPlugin = $prose(() => {
  return new Plugin({
    key: new PluginKey("br-to-hardbreak"),
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const hardbreakType = newState.schema.nodes.hardbreak;
      if (!hardbreakType) return null;

      const targets: { from: number; to: number }[] = [];
      newState.doc.descendants((node, pos) => {
        if (node.type.name !== "html" || !BR_RE.test(node.textContent.trim())) return true;
        const $pos = newState.doc.resolve(pos);
        for (let d = $pos.depth; d >= 0; d--) {
          if (TABLE_CELL_TYPES.has($pos.node(d).type.name)) return true;
        }
        targets.push({ from: pos, to: pos + node.nodeSize });
        return true;
      });
      if (targets.length === 0) return null;

      let tr = newState.tr;
      for (const { from, to } of targets.reverse()) {
        tr = tr.replaceWith(from, to, hardbreakType.create());
      }
      return tr;
    },
  });
});
