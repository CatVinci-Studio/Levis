import { parserCtx } from "@milkdown/kit/core";
import { Plugin } from "@milkdown/kit/prose/state";
import { Slice } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";

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

          let doc;
          try {
            doc = ctx.get(parserCtx)(text);
          } catch {
            return false;
          }
          if (!doc || typeof doc === "string" || doc.content.size === 0) return false;
          view.dispatch(view.state.tr.replaceSelection(Slice.maxOpen(doc.content)).scrollIntoView());
          return true;
        },
      },
    }),
);
