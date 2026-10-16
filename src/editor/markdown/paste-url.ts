import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/**
 * A pasted URL becomes a link whose text is the URL, written `[url](url)`.
 *
 * Left to the markdown parser, a bare URL is a GFM autolink literal, which
 * remark writes back as `<https://...>` - a form readers took for a bug
 * (issue #60), and one that only reads as a link in the source to someone
 * who knows the autolink syntax. `[url](url)` is the plain link syntax,
 * clickable in the editor and in every Markdown renderer (a bare URL is
 * not: CommonMark without GFM leaves it text), and it is written back the
 * same way because the link mark remembers its syntax (markdown-output.ts).
 * The text is the URL rather than empty, as some apps write it: `[](url)`
 * shows nothing at all on GitHub and most other renderers.
 */

/** The URL, when the pasted text is one URL and nothing else. */
export function bareUrl(text: string): string | null {
  const trimmed = text.trim();
  return /^(?:(?:https?|ftp):\/\/|mailto:)[^\s<>]+$/i.test(trimmed)
    ? trimmed
    : null;
}

/** Inserts `url` as a link over the selection; false when there is no link
 *  mark here (inside code, say), so the caller pastes it as text. */
export function insertUrlLink(view: EditorView, url: string): boolean {
  const { state } = view;
  const link = state.schema.marks.link;
  const $from = state.selection.$from;
  if (
    !link ||
    $from.parent.type.spec.code ||
    !$from.parent.type.allowsMarkType(link)
  )
    return false;
  view.dispatch(
    state.tr
      .replaceSelectionWith(
        state.schema.text(url, [link.create({ href: url })]),
        false,
      )
      // Typing straight after the pasted URL should not extend the link.
      .setStoredMarks([])
      .scrollIntoView(),
  );
  return true;
}

export const pasteUrlPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handlePaste(view, event) {
          const url = bareUrl(event.clipboardData?.getData("text/plain") ?? "");
          return url !== null && insertUrlLink(view, url);
        },
      },
    }),
);
