import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { caretAt } from "./enclosure";

/**
 * Bold (rung 2) and italic (rung 1) as commands, for the iPhone keyboard
 * toolbar. They are `md_span` nodes here, not marks (see md-span-schema.ts
 * and enclosure.ts), so ProseMirror's toggleMark does not apply:
 *
 *   - inside a span of this style, with nothing or all of it selected:
 *     unwrap it back to plain text;
 *   - a selection within one paragraph: wrap it in a new span;
 *   - nothing selected: open an empty span at the caret to type into,
 *     exactly as typing the delimiter does (md-span-autopair-plugin.ts).
 *
 * Returns false where none of these apply (a selection across blocks, or
 * inside code), leaving the document as it was.
 */
export function toggleSpan(view: EditorView, rung: 1 | 2): boolean {
  const { state } = view;
  const { $from, $to, from, to, empty } = state.selection;
  const spanType = state.schema.nodes.md_span;
  if (!spanType) return false;

  // Unwrap: the selection sits in (or exactly covers) a span of this style.
  const parent = $from.parent;
  if (
    parent.type === spanType &&
    parent.attrs.delim === "*" &&
    parent.attrs.rung === rung &&
    $to.parent === parent
  ) {
    const start = $from.before();
    const tr = state.tr.replaceWith(start, $from.after(), parent.content);
    tr.setSelection(
      TextSelection.create(tr.doc, from - 1, Math.max(from - 1, to - 1)),
    );
    view.dispatch(tr);
    return true;
  }

  if (!$from.sameParent($to) || !parent.inlineContent || parent.type.spec.code)
    return false;

  if (empty) {
    const tr = state.tr.replaceWith(
      from,
      to,
      spanType.create({ delim: "*", rung }),
    );
    view.dispatch(caretAt(tr, from + 1));
    return true;
  }

  const content = state.doc.slice(from, to).content;
  const node = spanType.create({ delim: "*", rung }, content);
  const tr = state.tr.replaceWith(from, to, node);
  tr.setSelection(
    TextSelection.create(tr.doc, from + 1, from + 1 + content.size),
  );
  view.dispatch(tr);
  return true;
}
