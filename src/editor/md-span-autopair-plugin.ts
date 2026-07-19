import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  caretAt,
  findRunClose,
  findRunOpen,
  hasPendingRunOpen,
  isImeKeyEvent,
  literalTextAfter,
  literalTextBefore,
  redirectMisattributedInput,
  stateWithLiveSelection,
} from "./enclosure";

interface SpanSpec {
  char: string;
  nodeType: "md_span" | "md_code_span";
  minRung: number;
  maxRung: number;
}

// "*" covers italic(1)/bold(2)/bold+italic(3) - typing it again while the
// shell is still empty upgrades the rung. "~" and "=" only have a 2-character
// form, so a lone one is left as literal text until a second, matching one
// completes it. "`" is its own node type (see md-span-schema.ts) since code
// content must never contain nested formatting.
const SPECS: SpanSpec[] = [
  { char: "*", nodeType: "md_span", minRung: 1, maxRung: 3 },
  { char: "~", nodeType: "md_span", minRung: 2, maxRung: 2 },
  { char: "=", nodeType: "md_span", minRung: 2, maxRung: 2 },
  { char: "`", nodeType: "md_code_span", minRung: 1, maxRung: 1 },
];

function isOurNode(name: string): boolean {
  return name === "md_span" || name === "md_code_span";
}

/**
 * Whether a paragraph is a "```" (or "```lang") code-fence line, returning
 * the language ("" for none) or null if it isn't one. Typing three backticks
 * doesn't leave literal "```" text - the autopair turns the first two into a
 * code span holding one literal backtick and the third closes it - so the
 * fence shape to recognize at Enter time is that node, optionally followed
 * by a language word. A literal "```lang" run (left by a paste or by
 * deleting a delimiter) counts too.
 */
function codeFenceLanguage(paragraph: ProseNode): string | null {
  if (paragraph.childCount === 0 || paragraph.childCount > 2) return null;
  const first = paragraph.child(0);
  let rest: string;
  if (first.type.name === "md_code_span" && first.textContent === "`") {
    if (paragraph.childCount === 2) {
      const second = paragraph.child(1);
      if (!second.isText) return null;
      rest = second.text ?? "";
    } else {
      rest = "";
    }
  } else if (paragraph.childCount === 1 && first.isText) {
    const match = /^```(.*)$/.exec(first.text ?? "");
    if (!match) return null;
    rest = match[1];
  } else {
    return null;
  }
  const language = rest.trim();
  return /\s/.test(language) ? null : language;
}

/**
 * What typing a delimiter character does for bold/italic/strikethrough/
 * highlight/inline code: open a fresh empty shell, upgrade an empty shell's
 * rung, close/step past the node the cursor is in, or convert an unclosed
 * literal run left in the text (see enclosure.ts's findRunOpen - this is
 * also how a delimiter deleted via Backspace comes back when retyped).
 * Cursor movement, delimiter reveal, and delimiter deletion all live in
 * enclosure.ts; content editing is fully unintercepted.
 */
export const mdSpanAutopairPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleTextInput(view, from, to, text) {
          if (view.composing) return false; // dispatching mid-composition aborts the IME preedit
          if (from !== to) return false;
          if (redirectMisattributedInput(view, from, to, text)) return true;

          const spec = SPECS.find((s) => s.char === text);
          if (!spec) return false;

          const { state } = view;
          const $pos = state.doc.resolve(from);
          const parent = $pos.parent;

          const isMatchingNode =
            parent.type.name === spec.nodeType &&
            (spec.nodeType !== "md_span" || parent.attrs.delim === spec.char);

          if (isMatchingNode) {
            const atContentEnd = $pos.parentOffset === parent.content.size;
            if (!atContentEnd) return false; // literal char mid-content

            const nodeStart = $pos.before($pos.depth);
            const nodeEnd = nodeStart + parent.nodeSize;

            if (parent.content.size === 0) {
              const rung = (parent.attrs.rung as number) ?? spec.minRung;
              if (spec.nodeType === "md_span" && rung < spec.maxRung) {
                const tr = state.tr.setNodeMarkup(nodeStart, undefined, {
                  delim: spec.char,
                  rung: rung + 1,
                });
                view.dispatch(tr);
                return true;
              }
              return false; // already at max rung (or a code span) - literal char as content
            }

            // Non-empty - already a valid node, just step past it.
            view.dispatch(caretAt(state.tr, nodeEnd));
            return true;
          }

          // WKWebView can normalize the caret from inside an empty shell to
          // just after it, so the delimiter that should upgrade/fill the
          // shell arrives attributed to the paragraph instead. Apply the
          // same semantics as the isMatchingNode-empty branch above, then
          // put the caret back inside where the user expects to type.
          const before = $pos.nodeBefore;
          if (
            before &&
            before.type.name === spec.nodeType &&
            before.content.size === 0 &&
            (spec.nodeType !== "md_span" || before.attrs.delim === spec.char)
          ) {
            const nodeStart = from - before.nodeSize;
            if (spec.nodeType === "md_span") {
              const rung = (before.attrs.rung as number) ?? spec.minRung;
              if (rung >= spec.maxRung) return false;
              const tr = state.tr.setNodeMarkup(nodeStart, undefined, {
                delim: spec.char,
                rung: rung + 1,
              });
              view.dispatch(caretAt(tr, nodeStart + 1));
              return true;
            }
            // Code span: the second "`" becomes the shell's literal content
            // (the "```" fence state - see codeFenceLanguage above).
            const tr = state.tr.insertText(spec.char, nodeStart + 1);
            view.dispatch(caretAt(tr, nodeStart + 2));
            return true;
          }

          if (isOurNode(parent.type.name)) return false; // inside a different one of our nodes (e.g. code) - never nest into it
          if (!parent.isTextblock || parent.type.spec.code) return false;

          const { text: textBefore, from: runStart } = literalTextBefore($pos);

          // Close an opening run left in literal text - longest rung first,
          // so "**hello" + "*" + "*" re-forms bold rather than italic.
          for (let rung = spec.maxRung; rung >= spec.minRung; rung--) {
            const open = findRunOpen(textBefore, spec.char, rung);
            if (!open) continue;
            const absOpen = runStart + open.openIdx;
            const node =
              spec.nodeType === "md_span"
                ? state.schema.nodes.md_span.create(
                    { delim: spec.char, rung },
                    state.schema.text(open.value),
                  )
                : state.schema.nodes.md_code_span.create(
                    {},
                    state.schema.text(open.value),
                  );
            const tr = state.tr.replaceWith(absOpen, to, node);
            view.dispatch(caretAt(tr, absOpen + node.nodeSize));
            return true;
          }

          // A longer opening run is still waiting for more closing chars
          // (e.g. "**hello" with only one "*" typed so far) - stay literal
          // so the multi-character closer can be built up keystroke by
          // keystroke instead of spawning an unrelated fresh shell.
          if (
            hasPendingRunOpen(textBefore, spec.char, spec.minRung, spec.maxRung)
          )
            return false;

          // Complete an opening run typed in FRONT of existing content whose
          // matching closing run already sits ahead in the literal text -
          // the forward mirror of the findRunOpen path above ("**" typed
          // before "hello**" forms bold on the second "*"). The typed run's
          // length picks the rung; see findRunClose for the exact-length
          // matching rule.
          let typedRun = 1;
          while (
            typedRun - 1 < textBefore.length &&
            textBefore[textBefore.length - typedRun] === spec.char
          )
            typedRun++;
          if (typedRun >= spec.minRung && typedRun <= spec.maxRung) {
            const { text: textAfter } = literalTextAfter($pos);
            const close = findRunClose(
              textBefore,
              textAfter,
              spec.char,
              typedRun,
            );
            if (close) {
              const openStart = from - (typedRun - 1);
              const value = textAfter.slice(0, close.valueLen);
              const node =
                spec.nodeType === "md_span"
                  ? state.schema.nodes.md_span.create(
                      { delim: spec.char, rung: typedRun },
                      state.schema.text(value),
                    )
                  : state.schema.nodes.md_code_span.create(
                      {},
                      state.schema.text(value),
                    );
              const tr = state.tr.replaceWith(
                openStart,
                to + close.valueLen + typedRun,
                node,
              );
              view.dispatch(caretAt(tr, openStart + 1));
              return true;
            }
          }

          // With content still following the caret the character is being
          // typed into the middle of existing text - never spawn a fresh
          // empty shell there, keep it literal. (Closing/converting an
          // opening run above still works mid-line.)
          if ($pos.parentOffset !== parent.content.size) return false;

          if (spec.minRung === 1) {
            const node =
              spec.nodeType === "md_span"
                ? state.schema.nodes.md_span.create({
                    delim: spec.char,
                    rung: 1,
                  })
                : state.schema.nodes.md_code_span.create();
            const tr = state.tr.replaceWith(from, to, node);
            view.dispatch(caretAt(tr, from + 1));
            return true;
          }

          // minRung > 1 ("~", "="): only open once this many consecutive
          // matching chars have just been typed literally; otherwise let this
          // one insert as plain text and check again next keystroke. The
          // check runs against the contiguous literal run only - a doc-wide
          // position range could reach across a node boundary.
          const need = spec.minRung - 1;
          if (!textBefore.endsWith(spec.char.repeat(need))) return false;
          const precedingStart = from - need;

          const node = state.schema.nodes.md_span.create({
            delim: spec.char,
            rung: spec.minRung,
          });
          const tr = state.tr.delete(precedingStart, from);
          tr.replaceWith(precedingStart, precedingStart, node);
          view.dispatch(caretAt(tr, precedingStart + 1));
          return true;
        },
        handleKeyDown(view, event) {
          if (event.key !== "Enter" || isImeKeyEvent(view, event)) return false;
          const state = stateWithLiveSelection(view);
          const { $from, empty } = state.selection;
          if (!empty) return false;
          const parent = $from.parent;
          if (parent.type.name !== "paragraph") return false;
          if ($from.parentOffset !== parent.content.size) return false; // fence must be what was just typed
          const language = codeFenceLanguage(parent);
          if (language === null) return false;

          const codeBlock = state.schema.nodes.code_block;
          if (!codeBlock) return false;
          const paragraphPos = $from.before($from.depth);
          const tr = state.tr
            .delete(paragraphPos + 1, paragraphPos + 1 + parent.content.size)
            .setNodeMarkup(paragraphPos, codeBlock, { language });
          view.dispatch(caretAt(tr, paragraphPos + 1));
          event.preventDefault();
          return true;
        },
      },
    }),
);
