import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { cursorTouches } from "./enclosure";
import { renderWhitelistedHtml } from "./raw-html-sanitize";

const rawHtmlPreviewKey = new PluginKey("raw-html-preview");

// Markdown parses inline HTML as SEPARATE nodes: "foo <b>bar</b>" is
// [text, html("<b>"), text("bar"), html("</b>")] - the pair never arrives
// as one fragment. GitHub still renders it as bold "bar" on one line, so
// this plugin pairs matching open/close tags within a textblock and styles
// the text between them via an inline decoration (the tags themselves hide
// while the cursor is away). Only inline FORMATTING tags participate -
// each maps to the class that mimics it.
const PAIR_TAG_CLASSES: Record<string, string> = {
  b: "rhtml-b",
  strong: "rhtml-b",
  i: "rhtml-i",
  em: "rhtml-i",
  u: "rhtml-u",
  ins: "rhtml-u",
  s: "rhtml-s",
  del: "rhtml-s",
  strike: "rhtml-s",
  sub: "rhtml-sub",
  sup: "rhtml-sup",
  mark: "rhtml-mark",
  kbd: "rhtml-kbd",
  code: "rhtml-code",
  small: "rhtml-small",
  a: "rhtml-a",
  span: "",
};

// Void elements can't open a pair - "<img ...>" is complete in itself and
// goes down the fragment-widget path instead.
const VOID_TAGS = new Set(["br", "img", "hr"]);

const OPEN_TAG_RE = /^<([a-zA-Z][a-zA-Z0-9]*)(\s[^<>]*)?>$/;
const CLOSE_TAG_RE = /^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>$/;

interface HtmlChild {
  from: number;
  to: number;
  text: string;
}

function fragmentWidget(rendered: { html: string; inline: boolean }) {
  return (view: EditorView, getPos: () => number | undefined) => {
    // Inline fragments (a lone <img>, <kbd>x</kbd>, <br>) stay in the
    // line they were written in; only block-level content (alignment
    // wrappers, headings) becomes its own block - matching GitHub.
    const el = document.createElement(rendered.inline ? "span" : "div");
    el.className = rendered.inline ? "raw-html-rendered raw-html-rendered-inline" : "raw-html-rendered";
    el.innerHTML = rendered.html;
    el.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const widgetPos = getPos();
      if (typeof widgetPos !== "number") return;
      const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, widgetPos - 1));
      view.dispatch(tr);
      view.focus();
    });
    return el;
  };
}

/** The href of a paired <a ...> open tag, scheme-validated by the same
 *  sanitizer whitelist - shown as a hover title on the styled range. */
function pairedLinkTitle(openTag: string): string | undefined {
  const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(openTag);
  const value = href?.[2] ?? href?.[3];
  return value || undefined;
}

function decorateTextblock(block: ProseNode, blockPos: number, state: EditorState, decorations: Decoration[]) {
  const htmls: HtmlChild[] = [];
  block.forEach((child, offset) => {
    if (child.type.name === "html") {
      const from = blockPos + 1 + offset;
      htmls.push({ from, to: from + child.nodeSize, text: child.textContent });
    }
  });
  if (htmls.length === 0) return;

  const stack: { tag: string; item: HtmlChild }[] = [];
  const pairs: { tag: string; open: HtmlChild; close: HtmlChild }[] = [];
  const fragments: HtmlChild[] = [];

  for (const item of htmls) {
    const open = OPEN_TAG_RE.exec(item.text);
    if (open && open[1].toLowerCase() in PAIR_TAG_CLASSES && !VOID_TAGS.has(open[1].toLowerCase())) {
      stack.push({ tag: open[1].toLowerCase(), item });
      continue;
    }
    const close = CLOSE_TAG_RE.exec(item.text);
    if (close && close[1].toLowerCase() in PAIR_TAG_CLASSES) {
      const tag = close[1].toLowerCase();
      let openIdx = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          openIdx = i;
          break;
        }
      }
      // No matching open: leave the stray close tag as visible raw text.
      // Mis-nested opens skipped over by this match stay unstyled too.
      if (openIdx >= 0) {
        pairs.push({ tag, open: stack[openIdx].item, close: item });
        stack.length = openIdx;
      }
      continue;
    }
    // Unmatched lone open/close tags of pairable elements never reach
    // here - anything else (a void tag, a self-contained fragment like
    // "<b>x</b>", a full block of HTML) renders as a widget below.
    fragments.push(item);
  }

  for (const { tag, open, close } of pairs) {
    // Cursor on either tag reveals BOTH raw (the pair is one edit unit).
    if (cursorTouches(state.selection, open.from, open.to) || cursorTouches(state.selection, close.from, close.to))
      continue;
    decorations.push(Decoration.inline(open.from, open.to, { class: "raw-html-source-hidden" }));
    decorations.push(Decoration.inline(close.from, close.to, { class: "raw-html-source-hidden" }));
    if (close.from <= open.to) continue; // nothing between the tags
    const cls = PAIR_TAG_CLASSES[tag];
    const attrs: Record<string, string> = {};
    if (cls) attrs.class = cls;
    if (tag === "a") {
      const title = pairedLinkTitle(open.text);
      if (title) attrs.title = title;
    }
    if (Object.keys(attrs).length > 0) decorations.push(Decoration.inline(open.to, close.from, attrs));
  }

  for (const item of fragments) {
    if (cursorTouches(state.selection, item.from, item.to)) continue;
    const rendered = renderWhitelistedHtml(item.text);
    // Not whitelisted (or unparsable): raw text stays visible, the
    // existing fallback for anything outside the whitelist.
    if (rendered === null) continue;
    decorations.push(Decoration.inline(item.from + 1, item.to - 1, { class: "raw-html-source-hidden" }));
    decorations.push(Decoration.widget(item.to, fragmentWidget(rendered), { side: -1 }));
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      decorateTextblock(node, pos, state, decorations);
      return false; // textblocks don't nest
    }
    return undefined;
  });
  return DecorationSet.create(state.doc, decorations);
}

/**
 * Raw-HTML counterpart to math-preview-plugin.ts: while the cursor is away,
 * whitelisted HTML renders in place of its source - paired inline tags
 * style the text between them right in the line (GitHub-style), and
 * self-contained fragments show as sanitized inline or block widgets.
 * Cursor on any of it reveals the raw markup for direct editing.
 */
export function createRawHtmlPreviewPlugin() {
  return $prose(
    () =>
      new Plugin<DecorationSet>({
        key: rawHtmlPreviewKey,
        state: {
          init: (_config, state) => buildDecorations(state),
          apply(tr, prev, _oldState, newState) {
            if (!tr.docChanged && !tr.selectionSet) return prev;
            return buildDecorations(newState);
          },
        },
        props: {
          decorations(state) {
            return rawHtmlPreviewKey.getState(state);
          },
        },
      }),
  );
}
