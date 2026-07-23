import { Plugin } from "@milkdown/kit/prose/state";
import { Slice } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import { parseMarkdownSource } from "./parse-markdown-source";

/**
 * Milkdown's clipboard plugin only parses pasted text as markdown when the
 * clipboard carries NO text/html flavor at all - but nearly every source
 * (browsers, chat apps, code editors, Word) attaches an HTML flavor even for
 * what is visually plain text, so pasted markdown source ("$x^2$",
 * "**bold**") lands as literal characters via the HTML path. When that HTML
 * is merely a styled wrapper around plain text - no semantically rich tags -
 * the markdown source in text/plain is the better representation: parse it,
 * exactly like the clipboard plugin's no-HTML branch would. Genuinely rich
 * HTML (links, tables, real formatting) still goes through the HTML path
 * untouched. Must be registered BEFORE the clipboard plugin - handlePaste
 * props run in registration order and the first to return true wins.
 */

const RICH_HTML_SELECTOR = [
  "a",
  "b",
  "strong",
  "em",
  "i",
  "u",
  "s",
  "del",
  "mark",
  "code",
  "pre",
  "kbd",
  "img",
  "video",
  "table",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "hr",
  "sub",
  "sup",
].join(",");

function htmlIsStyledPlainText(html: string): boolean {
  const template = document.createElement("template");
  template.innerHTML = html;
  // Every custom node type this editor defines (md_span, md_code_span,
  // math_inline, math_block, ...) marks its wrapper element with data-type -
  // that's real node data, not styling, regardless of which (possibly bare
  // span/div) tag it rides on. Content copied from Levis itself - even back
  // into Levis - would otherwise get misread as "styled plain text" here:
  // its wrapper tags aren't in RICH_HTML_SELECTOR, so this plugin would
  // discard the HTML and re-parse the plain-text fallback as markdown
  // instead, which for math nodes (whose text content is bare LaTeX with no
  // $ delimiters) silently drops the formula entirely.
  if (template.content.querySelector("[data-type]")) return false;
  return !template.content.querySelector(RICH_HTML_SELECTOR);
}

export const pasteMarkdownSourcePlugin = $prose(
  (ctx) =>
    new Plugin({
      props: {
        handlePaste(view, event) {
          const data = event.clipboardData;
          if (!data) return false;
          if (view.state.selection.$from.node().type.spec.code) return false; // inside code: paste stays literal
          if (data.getData("vscode-editor-data")) return false; // clipboard plugin turns these into a code block
          const html = data.getData("text/html");
          if (!html) return false; // the clipboard plugin's own branch already markdown-parses this case
          const text = data.getData("text/plain");
          if (!text || !htmlIsStyledPlainText(html)) return false;

          const doc = parseMarkdownSource(ctx, text);
          if (!doc || typeof doc === "string" || doc.content.size === 0)
            return false;
          view.dispatch(
            view.state.tr
              .replaceSelection(Slice.maxOpen(doc.content))
              .scrollIntoView(),
          );
          return true;
        },
      },
    }),
);
