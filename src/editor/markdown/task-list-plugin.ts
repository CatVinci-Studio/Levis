import { $prose } from "@milkdown/kit/utils";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";

const CHECKBOX_HIT_WIDTH = 24;

/**
 * Milkdown's gfm preset only marks task list items with a `data-checked`
 * attribute — it renders no actual checkbox glyph or click handling. This
 * plugin adds a CSS-drawn checkbox (see milkdown-theme.css) and toggles the
 * node's `checked` attr when that glyph area is clicked, without pulling in
 * @milkdown/components (which drags in a Vue runtime for one checkbox).
 */
export const taskListClickPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleClickOn(view, _pos, node, nodePos, event) {
          if (node.type.name !== "list_item" || node.attrs.checked == null)
            return false;

          const target = event.target as HTMLElement | null;
          const li = target?.closest(
            'li[data-item-type="task"]',
          ) as HTMLElement | null;
          if (!li) return false;

          const rect = li.getBoundingClientRect();
          if (event.clientX - rect.left > CHECKBOX_HIT_WIDTH) return false;

          view.dispatch(
            view.state.tr.setNodeMarkup(nodePos, undefined, {
              ...node.attrs,
              checked: !node.attrs.checked,
            }),
          );
          return true;
        },
      },
    }),
);

// Chinese input: with an IME on, "[" and "]" type as 【 and 】 (and many
// IMEs pair them, leaving the caret between), so the GFM "[ ] " rule never
// fires. A list item whose whole text is 【】, 【 】 or 【x】 (or the
// full-width ［］) becomes a task, as does a paragraph reading "- 【】" -
// written out as standard "- [ ] " markdown. The looser ASCII spellings
// people type for the same thing, "[]" and "-[]", count too. The whole
// paragraph is checked, not just the text before the caret, so a paired
// 【|】 counts. Typed input and IME commits only; a paste never converts.
const CJK_TASK = /^\s*[【［[]\s*([xX√✓]?)\s*[】］\]]\s*$/;
const CJK_TASK_PARAGRAPH = /^\s*[-*+]\s*[【［[]\s*([xX√✓]?)\s*[】］\]]\s*$/;

// The document right after a conversion: a space typed while it's still
// the current one is the separator of "[ ] " (the GFM spelling, which now
// converts at the "]") and is dropped rather than starting the item.
const convertedDoc = new WeakMap<EditorView, ProseNode>();

function convertCjkTask(
  view: EditorView,
  // The paragraph's text as it will read once this input lands.
  text: string,
): boolean {
  const { state } = view;
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== "paragraph") return false;
  const paraStart = $from.start();
  const paraEnd = $from.end();
  const item = $from.depth >= 2 ? $from.node($from.depth - 1) : null;

  if (item?.type.name === "list_item" && $from.index($from.depth - 1) === 0) {
    const match = CJK_TASK.exec(text);
    if (!match || item.attrs.checked != null) return false;
    const tr = state.tr
      .delete(paraStart, paraEnd)
      .setNodeMarkup($from.before($from.depth - 1), undefined, {
        ...item.attrs,
        checked: match[1] !== "",
      });
    view.dispatch(tr.scrollIntoView());
    convertedDoc.set(view, view.state.doc);
    return true;
  }

  const match = CJK_TASK_PARAGRAPH.exec(text);
  const { bullet_list, list_item, paragraph } = state.schema.nodes;
  if (!match || item?.type.name === "list_item") return false;
  if (!bullet_list || !list_item || !paragraph) return false;
  const list = bullet_list.create(null, [
    list_item.create({ checked: match[1] !== "" }, paragraph.create()),
  ]);
  const before = $from.before();
  const tr = state.tr.replaceWith(before, $from.after(), list);
  // Inside the new paragraph: list, item, paragraph openings.
  tr.setSelection(TextSelection.create(tr.doc, before + 3));
  view.dispatch(tr.scrollIntoView());
  convertedDoc.set(view, view.state.doc);
  return true;
}

export const cjkTaskInputPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleTextInput(view, from, to, text) {
          if (view.composing) return false;
          const justConverted = convertedDoc.get(view) === view.state.doc;
          convertedDoc.delete(view);
          if (justConverted && text === " ") return true;
          const { $from } = view.state.selection;
          if ($from.parent.type.name !== "paragraph") return false;
          const start = $from.start();
          const full =
            view.state.doc.textBetween(start, from) +
            text +
            view.state.doc.textBetween(to, $from.end());
          return convertCjkTask(view, full);
        },
        handleDOMEvents: {
          // An IME commit doesn't go through handleTextInput; look once
          // ProseMirror has read the committed text back in.
          compositionend(view) {
            setTimeout(() => {
              if (view.composing || view.isDestroyed) return;
              const { $from } = view.state.selection;
              if ($from.parent.type.name !== "paragraph") return;
              convertCjkTask(view, $from.parent.textContent);
            });
            return false;
          },
        },
      },
    }),
);
