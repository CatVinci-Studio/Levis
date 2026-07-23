import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { isImeKeyEvent } from "./enclosure";

/** The leading spaces/tabs of the LAST line in `textBeforeCursor` - what a
 *  code editor's Enter key copies onto the new line. Pure so it's testable
 *  without a real ProseMirror doc. */
export function leadingWhitespaceOfLastLine(textBeforeCursor: string): string {
  const lastNewline = textBeforeCursor.lastIndexOf("\n");
  const lastLine = textBeforeCursor.slice(lastNewline + 1);
  return lastLine.match(/^[ \t]*/)?.[0] ?? "";
}

/**
 * Enter inside a code block carries the current line's indentation onto the
 * new one, like an ordinary code editor - stock ProseMirror's `newlineInCode`
 * (the default ultimately reached via the base keymap) just inserts a bare
 * "\n" with nothing copied.
 *
 * Registered AFTER escape-trailing-block-plugin.ts in the plugin chain: that
 * plugin's own (narrower) Enter handling - escaping out of the very last
 * top-level code block when the cursor sits on an empty trailing line - must
 * get first refusal, since "jump out of the block" and "indent the next
 * line" are different intents for what looks like the same keystroke. This
 * plugin only ever sees an Enter that escape-trailing-block-plugin declined.
 */
export const codeBlockIndentPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (event.key !== "Enter" || event.shiftKey) return false;
          if (isImeKeyEvent(view, event)) return false;

          const { state } = view;
          const { $from, empty } = state.selection;
          if (!empty || $from.parent.type.name !== "code_block") return false;

          const textBeforeCursor = $from.parent.textBetween(
            0,
            $from.parentOffset,
            "\n",
          );
          const indent = leadingWhitespaceOfLastLine(textBeforeCursor);
          if (!indent) return false; // nothing to copy - default newlineInCode is equivalent

          view.dispatch(state.tr.insertText("\n" + indent).scrollIntoView());
          return true;
        },
      },
    }),
);
