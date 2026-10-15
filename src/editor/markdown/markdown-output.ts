import type { Ctx } from "@milkdown/kit/ctx";
import { defaultValueCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import { linkSchema } from "@milkdown/kit/preset/commonmark";
import type { MarkdownNode } from "@milkdown/kit/transformer";
import { defaultHandlers, type Handle } from "mdast-util-to-markdown";

// How the editor writes markdown back out. Every rule here exists to keep a
// saved file close to what the user wrote, instead of remark-stringify's
// house style.

/**
 * Serializes a thematic break as "---", except as the document's very first
 * block, where it stays "***".
 *
 * A leading "---" is the frontmatter OPENING fence: remark-frontmatter
 * (frontmatter-schema.ts) would then take the next "---" in the file as the
 * closing one and swallow everything between them into a YAML block the next
 * time the file is opened. remark-frontmatter does register an unsafe pattern
 * against exactly this, but mdast-util-to-markdown never runs a thematic
 * break through its escaping - the handler's return value is used verbatim -
 * so the one ambiguous position has to avoid the dash form itself.
 */
const thematicBreak: Handle = (node, parent) => {
  const isFirstBlock = parent?.type === "root" && parent.children[0] === node;
  return isFirstBlock ? "***" : "---";
};

/**
 * Milkdown stores list and list-item `spread` as the STRINGS "true" /
 * "false" and hands bullet lists and list items to remark as-is (ordered
 * lists alone compare `=== "true"`). "false" is truthy, so every tight
 * bullet list - and every item with a nested list - was written back loose,
 * a blank line between each item, the first time a file was saved.
 *
 * Fixed in the list handler, items included, rather than by also replacing
 * listItem: that handler is remark-gfm's (it writes the task-list "[ ]"),
 * and a listItem here would override it.
 */
const toBoolean = (spread: unknown) => spread === true || spread === "true";

const list: Handle = (node, parent, state, info) => {
  node.spread = toBoolean(node.spread);
  for (const item of node.children) item.spread = toBoolean(item.spread);
  return defaultHandlers.list(node, parent, state, info);
};

/**
 * Milkdown's parser forgets every open mark whenever it closes a node, so
 * in `[see **this** here](url)` the link only covered "see " and "this":
 * " here" came back as plain text and the URL fell off it on the next save.
 * Re-opening the link before each child keeps it on all of them, whatever
 * node the previous child closed. (Inline code, which keeps its own text
 * unmarked, carries the link on itself - md-span-schema.ts.)
 */
function keepLinkAcrossInlineNodes(ctx: Ctx): void {
  ctx.update(linkSchema.key, (prev) => (innerCtx) => {
    const schema = prev(innerCtx);
    return {
      ...schema,
      parseMarkdown: {
        match: schema.parseMarkdown.match,
        runner: (state, node, markType) => {
          const attrs = {
            href: node.url as string,
            title: node.title as string,
          };
          for (const child of (node.children ?? []) as MarkdownNode[]) {
            state.openMark(markType, attrs);
            state.next(child);
            state.closeMark(markType);
          }
        },
      },
    };
  });
}

/**
 * The bullet the document's own lists use ("-", "*" or "+"), by majority,
 * or null when it has none. remark writes "*" whatever the file had, so
 * the first edit to a README written with "-" rewrote every bullet in it
 * and the file's diff ran to hundreds of lines.
 */
export function documentBullet(markdown: string): "-" | "*" | "+" | null {
  const counts = { "-": 0, "*": 0, "+": 0 };
  for (const match of markdown.matchAll(/^[ \t]*([-*+])[ \t]+\S/gm))
    counts[match[1] as keyof typeof counts]++;
  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? (best as "-" | "*" | "+") : null;
}

/**
 * A GitHub alert's marker - `> [!NOTE]` and its kin, opening a quote - is
 * written as it was typed. remark escapes the bracket ("\\[!NOTE]") in case
 * it starts a reference link, which Textus still reads as an alert
 * (github-alert-plugin.ts) but GitHub and every other tool no longer do.
 */
const ALERT_MARKER = /^\\\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/;

function keepAlertMarker(text: Handle): Handle {
  return (node, parent, state, info) => {
    const out = text(node, parent, state, info);
    const opensQuote =
      parent?.type === "paragraph" &&
      parent.children[0] === node &&
      state.stack.includes("blockquote");
    return opensQuote ? out.replace(ALERT_MARKER, "[!$1]") : out;
  };
}

/** Installs the rules above. `update`, not `set`: the slice already carries
 *  Milkdown's own text/strong/emphasis handlers, and replacing it wholesale
 *  would drop them. */
export function configureMarkdownOutput(ctx: Ctx): void {
  keepLinkAcrossInlineNodes(ctx);
  // The editor's opening text (MilkdownEditor sets it before this runs).
  const initial = ctx.get(defaultValueCtx);
  const bullet = typeof initial === "string" ? documentBullet(initial) : null;
  ctx.update(remarkStringifyOptionsCtx, (options) => ({
    ...options,
    ...(bullet ? { bullet } : {}),
    handlers: {
      ...options.handlers,
      thematicBreak,
      list,
      text: keepAlertMarker(
        (options.handlers?.text as Handle | undefined) ?? defaultHandlers.text,
      ),
    },
  }));
}
