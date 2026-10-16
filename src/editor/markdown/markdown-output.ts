import type { Ctx } from "@milkdown/kit/ctx";
import { defaultValueCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import { linkSchema } from "@milkdown/kit/preset/commonmark";
import type { MarkdownNode } from "@milkdown/kit/transformer";
import {
  defaultHandlers,
  type Handle,
  type State,
} from "mdast-util-to-markdown";

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
 * Which markdown syntax a link was written in, kept on the mark so a save
 * writes it back the same way. remark-stringify picks the form from the
 * content alone: any link whose text equals its URL came out as
 * `<https://...>`, so a `[https://x](https://x)` the user typed was
 * rewritten on the first save.
 *
 * - "autolink": `<https://...>` or a bare GFM URL - written `<...>`,
 *   remark's choice, which every Markdown tool reads as a link.
 * - "empty": `[](https://...)`. There is no text to put the mark on, so
 *   Milkdown dropped the link altogether: invisible in the editor, and gone
 *   from the file on the next save. It shows its URL as text instead (as
 *   Typora does) and is written back empty while that text is untouched.
 * - "resource": everything else, and every link made in the editor -
 *   a pasted URL included (paste-url.ts).
 */
export type LinkSyntax = "resource" | "autolink" | "empty";

interface Positioned {
  position?: { end?: { offset?: number } };
}

/** Tells the three apart by source position: an autolink's only child ends
 *  at most one character (the `>`) before the link does, while
 *  `[text](url)` always has `](url)` after its text. Without positions the
 *  link is left to remark's default, which is what it always was. */
export function linkSyntaxOf(node: MarkdownNode): LinkSyntax {
  const children = (node.children ?? []) as MarkdownNode[];
  if (children.length === 0) return "empty";
  const end = (node as Positioned).position?.end?.offset;
  const childEnd = (children[children.length - 1] as Positioned).position?.end
    ?.offset;
  if (end === undefined || childEnd === undefined) return "autolink";
  return children.length === 1 && childEnd >= end - 1 ? "autolink" : "resource";
}

/** The visible text of a link, for comparing against its URL. */
function textOf(node: { value?: unknown; children?: unknown[] }): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? [])
    .map((child) => textOf(child as { value?: unknown; children?: unknown[] }))
    .join("");
}

/**
 * Milkdown's parser forgets every open mark whenever it closes a node, so
 * in `[see **this** here](url)` the link only covered "see " and "this":
 * " here" came back as plain text and the URL fell off it on the next save.
 * Re-opening the link before each child keeps it on all of them, whatever
 * node the previous child closed. (Inline code, which keeps its own text
 * unmarked, carries the link on itself - md-span-schema.ts.)
 *
 * The same override carries the link's syntax (LinkSyntax above) into the
 * mark, and through the DOM too, so a link copied and pasted inside the
 * editor keeps it.
 */
function keepLinkAcrossInlineNodes(ctx: Ctx): void {
  ctx.update(linkSchema.key, (prev) => (innerCtx) => {
    const schema = prev(innerCtx);
    return {
      ...schema,
      attrs: {
        ...schema.attrs,
        syntax: { default: "resource", validate: "string" },
      },
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (dom) => {
            if (!(dom instanceof HTMLElement)) return false;
            const syntax = dom.dataset.linkSyntax;
            return {
              href: dom.getAttribute("href"),
              title: dom.getAttribute("title"),
              syntax:
                syntax === "autolink" || syntax === "empty"
                  ? syntax
                  : "resource",
            };
          },
        },
      ],
      toDOM: (mark, inline) => {
        // The stock toDOM spreads every attr onto the <a>, which would add
        // a meaningless syntax="resource" attribute to each link.
        const { syntax, ...attrs } = mark.attrs;
        const [tag, domAttrs] = schema.toDOM!(
          { ...mark, attrs } as typeof mark,
          inline,
        ) as [string, Record<string, unknown>];
        return [
          tag,
          syntax === "resource"
            ? domAttrs
            : { ...domAttrs, "data-link-syntax": syntax },
        ];
      },
      parseMarkdown: {
        match: schema.parseMarkdown.match,
        runner: (state, node, markType) => {
          const syntax = linkSyntaxOf(node);
          const attrs = {
            href: node.url as string,
            title: node.title as string,
            syntax,
          };
          if (syntax === "empty") {
            if (!attrs.href) return; // `[]()` has nothing to show
            state.openMark(markType, attrs);
            state.addText(attrs.href);
            state.closeMark(markType);
            return;
          }
          for (const child of (node.children ?? []) as MarkdownNode[]) {
            state.openMark(markType, attrs);
            state.next(child);
            state.closeMark(markType);
          }
        },
      },
      toMarkdown: {
        match: schema.toMarkdown.match,
        runner: (state, mark) => {
          state.withMark(mark, "link", undefined, {
            title: mark.attrs.title,
            url: mark.attrs.href,
            data: { linkSyntax: mark.attrs.syntax },
          });
        },
      },
    };
  });
}

/**
 * Runs one of remark's link functions with its `resourceLink` switch ("never
 * <...>") set the way this link's syntax asks. The option is shared by the
 * whole serialization, so it is set only around the one call.
 */
function asWritten<T>(
  node: { data?: unknown },
  state: State,
  write: () => T,
): T {
  const syntax = (node.data as { linkSyntax?: LinkSyntax } | undefined)
    ?.linkSyntax;
  if (syntax === "autolink") return write();
  const previous = state.options.resourceLink;
  state.options.resourceLink = true;
  try {
    return write();
  } finally {
    state.options.resourceLink = previous;
  }
}

type PeekingHandle = Handle & { peek: Handle };
const defaultLink = defaultHandlers.link as PeekingHandle;

/** Writes a link in the syntax it was read in (LinkSyntax above). */
const link = Object.assign(
  ((node, parent, state, info) => {
    const empty =
      (node.data as { linkSyntax?: LinkSyntax } | undefined)?.linkSyntax ===
      "empty";
    // Once its shown URL is edited, an empty link is an ordinary one.
    const written =
      empty && textOf(node) === node.url ? { ...node, children: [] } : node;
    return asWritten(node, state, () =>
      defaultLink(written, parent, state, info),
    );
  }) as Handle,
  {
    // containerPhrasing asks `peek` which character the link starts with.
    peek: ((node, parent, state, info) =>
      asWritten(node, state, () =>
        defaultLink.peek(node, parent, state, info),
      )) as Handle,
  },
);

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
      link,
      text: keepAlertMarker(
        (options.handlers?.text as Handle | undefined) ?? defaultHandlers.text,
      ),
    },
  }));
}
