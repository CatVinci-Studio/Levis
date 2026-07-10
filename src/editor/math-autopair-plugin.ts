import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { findRunOpen, isImeKeyEvent, literalTextBefore, redirectMisattributedInput } from "./enclosure";

const DOLLAR = "$";

/** See the Enter handler: the paragraph shapes that mean "the user typed $$". */
function isMathFenceLine(paragraph: ProseNode): boolean {
  if (paragraph.childCount === 1 && paragraph.child(0).isText) return paragraph.child(0).text === "$$";
  if (paragraph.childCount < 1 || paragraph.childCount > 2) return false;
  for (let i = 0; i < paragraph.childCount; i++) {
    const child = paragraph.child(i);
    if (child.type.name !== "math_inline" || child.content.size !== 0) return false;
  }
  return true;
}

/**
 * What typing "$" does, modeled on how code editors auto-close brackets -
 * built on real math_inline nodes so the shared enclosure model
 * (enclosure.ts: delimiter reveal, cursor phases, delimiter deletion) and
 * math-preview-plugin (KaTeX render, floating live preview) drive the whole
 * experience uniformly for inline and block math alike:
 *
 * - Typing "$" outside any math opens an *empty* math_inline node right away,
 *   cursor inside - unless unclosed literal "$..."-looking text directly
 *   before the caret can be converted into a real formula instead (the
 *   findRunOpen path, which is also how a deleted "$" comes back when
 *   retyped).
 * - Typing "$" again while inside, exactly at the end of the node's content,
 *   closes it: non-empty content stays a real math_inline node and the
 *   cursor steps past it; empty content reverts to literal "$$" text instead
 *   of leaving a near-invisible empty formula node behind.
 * - Typing "$" anywhere else inside math source is just literal text.
 * - Enter right after opening an empty pair - with nothing else on the line
 *   - promotes the shell to an empty math_block.
 */
export const mathAutopairPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleTextInput(view, from, to, text) {
          if (view.composing) return false; // dispatching mid-composition aborts the IME preedit
          if (from !== to) return false; // a real selection just gets replaced normally
          if (redirectMisattributedInput(view, from, to, text)) return true;
          if (text !== DOLLAR) return false;

          const { state } = view;
          const $pos = state.doc.resolve(from);
          const parent = $pos.parent;
          const inMath = parent.type.name === "math_inline" || parent.type.name === "math_block";

          if (inMath) {
            if ($pos.parentOffset !== parent.content.size) return false; // literal "$" mid-source

            const nodeStart = $pos.before($pos.depth);
            const nodeEnd = nodeStart + parent.nodeSize;

            if (parent.content.size === 0) {
              // Empty pair, closed immediately - revert to literal "$$" rather
              // than leave an empty formula node rendering as a stray widget.
              const tr = state.tr.replaceWith(nodeStart, nodeEnd, state.schema.text("$$"));
              tr.setSelection(TextSelection.create(tr.doc, nodeStart + 2));
              view.dispatch(tr);
              return true;
            }

            // Non-empty - leave it as a real node, step past it.
            view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, nodeEnd)));
            return true;
          }

          // WKWebView can normalize the caret from inside an empty shell to
          // just after it, so the closing "$" arrives attributed to the
          // paragraph instead of the shell - same close-empty-pair
          // semantics as the inMath branch above.
          const before = $pos.nodeBefore;
          if (before && before.type.name === "math_inline" && before.content.size === 0) {
            const nodeStart = from - before.nodeSize;
            const tr = state.tr.replaceWith(nodeStart, from, state.schema.text("$$"));
            tr.setSelection(TextSelection.create(tr.doc, nodeStart + 2));
            view.dispatch(tr);
            return true;
          }

          if (!parent.isTextblock || parent.type.spec.code) return false;

          const { text: textBefore, from: runStart } = literalTextBefore($pos);
          const open = findRunOpen(textBefore, DOLLAR, 1);
          if (open) {
            const mathInline = state.schema.nodes.math_inline;
            const node = mathInline.create({}, state.schema.text(open.value));
            const absOpen = runStart + open.openIdx;
            const tr = state.tr.replaceWith(absOpen, to, node);
            tr.setSelection(TextSelection.create(tr.doc, absOpen + node.nodeSize));
            view.dispatch(tr);
            return true;
          }

          // Fresh "$" - open an empty math_inline node, cursor inside.
          const mathInline = state.schema.nodes.math_inline;
          const tr = state.tr.replaceWith(from, to, mathInline.create());
          tr.setSelection(TextSelection.create(tr.doc, from + 1));
          view.dispatch(tr);
          return true;
        },
        handleKeyDown(view, event) {
          if (event.key !== "Enter" || isImeKeyEvent(view, event)) return false;
          const { state } = view;
          const { $from, empty } = state.selection;
          if (!empty) return false;
          const parent = $from.parent;

          // A line whose whole content amounts to a typed "$$" also promotes
          // to a block. That state comes in several shapes: literal "$$"
          // text (the second "$" closed the empty pair and reverted it - see
          // handleTextInput above), a single empty shell the caret got
          // normalized out of (WKWebView), or two empty shells left by the
          // pre-fix version of that normalization bug.
          if (parent.type.name === "paragraph" && $from.parentOffset === parent.content.size && isMathFenceLine(parent)) {
            const paragraphPos = $from.before($from.depth);
            const tr = state.tr
              .delete(paragraphPos + 1, paragraphPos + 1 + parent.content.size)
              .setNodeMarkup(paragraphPos, state.schema.nodes.math_block);
            tr.setSelection(TextSelection.create(tr.doc, paragraphPos + 1));
            view.dispatch(tr);
            event.preventDefault();
            return true;
          }

          if (parent.type.name !== "math_inline") return false;
          if (parent.content.size !== 0) return false;

          const paragraphDepth = $from.depth - 1;
          const paragraph = $from.node(paragraphDepth);
          // The line must contain nothing but the typed "$$" (in any of its
          // shapes - see isMathFenceLine) so a stray empty pair elsewhere on
          // a longer line can't hijack Enter.
          if (!isMathFenceLine(paragraph)) return false;

          const paragraphPos = $from.before(paragraphDepth);
          const mathBlock = state.schema.nodes.math_block;
          const tr = state.tr
            .delete(paragraphPos + 1, paragraphPos + 1 + paragraph.content.size)
            .setNodeMarkup(paragraphPos, mathBlock);
          tr.setSelection(TextSelection.create(tr.doc, paragraphPos + 1));
          view.dispatch(tr);
          event.preventDefault();
          return true;
        },
      },
    }),
);
