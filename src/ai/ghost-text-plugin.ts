import type { EditorView } from "@milkdown/kit/prose/view";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { isImeKeyEvent } from "../editor/enclosure";
import { isLargeDoc } from "../editor/large-doc";
import { createDebouncedTask } from "./debounced-task";
import { hasPendingEdits } from "./pending-edit-plugin";
import { ai } from "../ipc";

const DEBOUNCE_MS = 450;
const MAX_CONTEXT_CHARS = 2000;
// Look-ahead after the cursor: enough for the model to splice into what
// follows when completing mid-document, small enough not to dominate the
// prompt.
const MAX_AFTER_CONTEXT_CHARS = 500;

export const ghostTextKey = new PluginKey("ghost-text");

/**
 * The completion context, split at the cursor - the model is told to write
 * the text that belongs exactly between the two parts. Anchoring both sides
 * to the cursor (rather than sending the document tail) is what keeps
 * mid-document completions continuing from the cursor instead of from
 * wherever the document ends.
 */
/**
 * Models often start a continuation with a space out of English habit; after
 * CJK text (or CJK punctuation) that space is wrong - CJK doesn't separate
 * with spaces - so it's stripped. Latin before-text keeps the suggestion
 * verbatim: a leading space there is usually a correct word boundary.
 */
function tidySuggestion(before: string, suggestion: string): string {
  return /[一-鿿㐀-䶿\u3000-〿＀-￯]$/.test(before)
    ? suggestion.replace(/^[ \t]+/, "")
    : suggestion;
}

function completionContext(
  view: EditorView,
  cursorPos: number,
): { before: string; after: string } {
  const before = view.state.doc.textBetween(0, cursorPos, "\n\n");
  const after = view.state.doc.textBetween(
    cursorPos,
    view.state.doc.content.size,
    "\n\n",
  );
  return {
    before: before.slice(Math.max(0, before.length - MAX_CONTEXT_CHARS)),
    after: after.slice(0, MAX_AFTER_CONTEXT_CHARS),
  };
}

/**
 * The suggestion is rendered via CSS generated content (data-suggestion +
 * ::after) instead of as real text inside the span: WebKit canonicalizes a
 * collapsed caret sitting before a contentEditable=false element that
 * contains text to a visible position AFTER it, painting the caret at the
 * end of the ghost text instead of where the user is actually typing.
 * Generated content offers no caret positions at all, so the caret stays
 * painted at the true insertion point.
 */
function ghostDecoration(
  view: EditorView,
  cursorPos: number,
  suggestion: string,
): GhostMeta {
  const decoration = Decoration.widget(
    cursorPos,
    () => {
      const span = document.createElement("span");
      span.className = "ghost-text";
      span.setAttribute("data-suggestion", suggestion);
      span.contentEditable = "false";
      return span;
    },
    { side: 1, ignoreSelection: true },
  );
  return {
    type: "set",
    decoration: DecorationSet.create(view.state.doc, [decoration]),
    suggestion,
    from: cursorPos,
  };
}

/// Runs a completion request right now at the cursor and shows it as ghost
/// text, bypassing the debounce/word-count gating the typing-triggered path
/// uses - for manual "trigger completion" entry points (e.g. a context menu
/// item). Unlike the silent auto-trigger path, this throws on failure so the
/// caller can surface the error to the user.
export async function triggerGhostTextNow(
  view: EditorView,
  provider: string,
  style: string | null,
  model: string | null,
): Promise<void> {
  const { selection } = view.state;
  if (!selection.empty)
    throw new Error("Place the cursor where you want the suggestion first.");

  const $pos = selection.$from;
  if (
    !$pos.parent.isTextblock ||
    $pos.parentOffset !== $pos.parent.content.size
  ) {
    throw new Error("Move the cursor to the end of a paragraph first.");
  }

  const cursorPos = selection.from;
  const { before, after } = completionContext(view, cursorPos);

  const raw = await ai.complete(provider, before, after, style, model);
  const suggestion = raw ? tidySuggestion(before, raw) : raw;
  if (!suggestion?.trim())
    throw new Error("The model returned an empty suggestion.");
  if (view.state.selection.from !== cursorPos) return; // cursor moved while we were waiting
  if (view.composing) return; // mid-IME - dispatching now would break the composition

  view.dispatch(
    view.state.tr.setMeta(
      ghostTextKey,
      ghostDecoration(view, cursorPos, suggestion),
    ),
  );
}

/// Shows a caller-supplied suggestion as ghost text at the caret, no backend
/// involved - the onboarding tutorial's completion step uses this with a
/// pre-written continuation so first-run users see the feature without an
/// AI account. Tab-accept and clear-on-edit behave exactly like the real
/// thing (same plugin state).
export function showGhostSuggestion(
  view: EditorView,
  suggestion: string,
): void {
  const { selection } = view.state;
  if (!selection.empty || view.composing || !suggestion) return;
  view.dispatch(
    view.state.tr.setMeta(
      ghostTextKey,
      ghostDecoration(view, selection.from, suggestion),
    ),
  );
}

interface GhostMeta {
  type: "set" | "clear";
  decoration?: DecorationSet;
  suggestion?: string;
  from?: number;
}

interface GhostState {
  decoration: DecorationSet;
  suggestion: string | null;
  from: number;
}

export function createGhostTextPlugin(options: {
  enabled: () => boolean;
  provider: () => string;
  /** Writing-assistance model; null keeps the provider's low-cost default. */
  model: () => string | null;
  /** User style directive for the completion prompt, null when unset. */
  style: () => string | null;
}) {
  const debounced = createDebouncedTask(DEBOUNCE_MS);

  return $prose(
    () =>
      new Plugin<GhostState>({
        key: ghostTextKey,
        state: {
          init(): GhostState {
            return {
              decoration: DecorationSet.empty,
              suggestion: null,
              from: 0,
            };
          },
          apply(tr, prev): GhostState {
            const meta = tr.getMeta(ghostTextKey) as GhostMeta | undefined;
            if (meta?.type === "set") {
              return {
                decoration: meta.decoration!,
                suggestion: meta.suggestion!,
                from: meta.from!,
              };
            }
            if (meta?.type === "clear") {
              return {
                decoration: DecorationSet.empty,
                suggestion: null,
                from: 0,
              };
            }
            if (tr.docChanged) {
              return {
                decoration: DecorationSet.empty,
                suggestion: null,
                from: 0,
              };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            return ghostTextKey.getState(state)?.decoration;
          },
          handleKeyDown(view, event) {
            if (isImeKeyEvent(view, event)) return false;
            const state = ghostTextKey.getState(view.state);
            if (!state?.suggestion || event.key !== "Tab") return false;
            event.preventDefault();
            const tr = view.state.tr.insertText(state.suggestion, state.from);
            tr.setMeta(ghostTextKey, { type: "clear" });
            view.dispatch(tr);
            return true;
          },
        },
        view() {
          return {
            update(view, prevState) {
              // The native caret is swapped for a CSS-drawn one (the ghost
              // span's ::before, see milkdown-theme.css) while the caret
              // sits exactly where a suggestion is showing: WebKit's caret
              // canonicalization otherwise paints the caret AFTER the
              // suggestion. Runs before every early return below - mock
              // suggestions (showGhostSuggestion) arrive while the plugin's
              // own triggering is disabled, and the swap must still track
              // the caret leaving/returning.
              const ghost = ghostTextKey.getState(view.state);
              const pinned =
                !!ghost?.suggestion &&
                view.state.selection.empty &&
                view.state.selection.from === ghost.from;
              view.dom.classList.toggle("ghost-text-caret", pinned);

              if (!options.enabled()) return;
              if (view.composing) return;
              if (isLargeDoc(view.state.doc)) return;
              if (
                view.state.doc.eq(prevState.doc) &&
                view.state.selection.eq(prevState.selection)
              ) {
                return;
              }
              // A pending agent edit already occupies this spot with its own
              // ghost-style insert widget (pending-edit-plugin.ts) - stacking
              // completion ghost text on top of it would be unreadable, and
              // accepting one via Tab could land inside the other.
              if (hasPendingEdits(view.state)) return;

              debounced.cancel();

              const { selection } = view.state;
              if (!selection.empty) return;

              const $pos = selection.$from;
              const atBlockEnd =
                $pos.parent.isTextblock &&
                $pos.parentOffset === $pos.parent.content.size;
              if (!atBlockEnd) return;

              const cursorPos = selection.from;
              const { before, after } = completionContext(view, cursorPos);
              // The cursor is at the end of its own paragraph, but the
              // document keeps going right after it (e.g. editing mid-
              // document) - a suggestion here would be inserted ahead of
              // content that already continues the thought, so auto-trigger
              // stays quiet. Manual trigger (triggerGhostTextNow) still
              // works - that's an explicit ask, not a typing side-effect.
              if (after.trim()) return;
              // No minimum context length: completion is opt-in via the
              // Settings toggle already, and gating on word count made the
              // very first sentence of a fresh document (and the onboarding
              // tutorial, which demonstrates completion in its first
              // paragraph) unable to trigger it at all. An empty before-text
              // is the only real no-op case - "continue from the exact end
              // of the before-text" is meaningless with no before-text.
              if (!before.trim()) return;

              debounced.schedule(async (isCurrent) => {
                let suggestion: string;
                try {
                  suggestion = await ai.complete(
                    options.provider(),
                    before,
                    after,
                    options.style(),
                    options.model(),
                  );
                } catch (err) {
                  // Not logged in, offline, or request failed - stays quiet in the
                  // UI (no error popup while you're just typing), but still
                  // logged so it's diagnosable instead of vanishing entirely.
                  console.error("[ghost-text] completion request failed:", err);
                  return;
                }
                if (!isCurrent()) return; // superseded by a newer trigger
                suggestion = tidySuggestion(before, suggestion);
                if (!suggestion?.trim()) return;
                if (!view.hasFocus() || view.state.selection.from !== cursorPos)
                  return;
                if (view.composing) return; // mid-IME - dispatching now would break the composition

                view.dispatch(
                  view.state.tr.setMeta(
                    ghostTextKey,
                    ghostDecoration(view, cursorPos, suggestion),
                  ),
                );
              });
            },
            destroy() {
              debounced.cancel();
            },
          };
        },
      }),
  );
}
