import type { EditorView } from "@milkdown/kit/prose/view";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { invoke } from "@tauri-apps/api/core";
import { countWords } from "../utils/word-count";
import { isImeKeyEvent } from "../editor/enclosure";
import { createDebouncedTask } from "./debounced-task";

// Below this much text before the cursor, there isn't enough context for a
// decent suggestion (and it's more likely to feel intrusive on a near-empty
// doc).
const MIN_CONTEXT_UNITS = 20;
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
  return /[一-鿿㐀-䶿　-〿＀-￯]$/.test(before)
    ? suggestion.replace(/^[ \t]+/, "")
    : suggestion;
}

function completionContext(view: EditorView, cursorPos: number): { before: string; after: string } {
  const before = view.state.doc.textBetween(0, cursorPos, "\n\n");
  const after = view.state.doc.textBetween(cursorPos, view.state.doc.content.size, "\n\n");
  return {
    before: before.slice(Math.max(0, before.length - MAX_CONTEXT_CHARS)),
    after: after.slice(0, MAX_AFTER_CONTEXT_CHARS),
  };
}

/// Runs a completion request right now at the cursor and shows it as ghost
/// text, bypassing the debounce/word-count gating the typing-triggered path
/// uses - for manual "trigger completion" entry points (e.g. a context menu
/// item). Unlike the silent auto-trigger path, this throws on failure so the
/// caller can surface the error to the user.
export async function triggerGhostTextNow(view: EditorView, provider: string): Promise<void> {
  const { selection } = view.state;
  if (!selection.empty) throw new Error("Place the cursor where you want the suggestion first.");

  const $pos = selection.$from;
  if (!$pos.parent.isTextblock || $pos.parentOffset !== $pos.parent.content.size) {
    throw new Error("Move the cursor to the end of a paragraph first.");
  }

  const cursorPos = selection.from;
  const { before, after } = completionContext(view, cursorPos);

  const raw = await invoke<string>("ai_complete", { provider, before, after });
  const suggestion = raw ? tidySuggestion(before, raw) : raw;
  if (!suggestion?.trim()) throw new Error("The model returned an empty suggestion.");
  if (view.state.selection.from !== cursorPos) return; // cursor moved while we were waiting
  if (view.composing) return; // mid-IME - dispatching now would break the composition

  const decoration = Decoration.widget(
    cursorPos,
    () => {
      const span = document.createElement("span");
      span.className = "ghost-text";
      span.textContent = suggestion;
      span.contentEditable = "false";
      return span;
    },
    { side: 1 },
  );

  view.dispatch(
    view.state.tr.setMeta(ghostTextKey, {
      type: "set",
      decoration: DecorationSet.create(view.state.doc, [decoration]),
      suggestion,
      from: cursorPos,
    } satisfies GhostMeta),
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

export function createGhostTextPlugin(options: { enabled: () => boolean; provider: () => string }) {
  const debounced = createDebouncedTask(DEBOUNCE_MS);

  return $prose(
    () =>
      new Plugin<GhostState>({
        key: ghostTextKey,
        state: {
          init(): GhostState {
            return { decoration: DecorationSet.empty, suggestion: null, from: 0 };
          },
          apply(tr, prev): GhostState {
            const meta = tr.getMeta(ghostTextKey) as GhostMeta | undefined;
            if (meta?.type === "set") {
              return { decoration: meta.decoration!, suggestion: meta.suggestion!, from: meta.from! };
            }
            if (meta?.type === "clear") {
              return { decoration: DecorationSet.empty, suggestion: null, from: 0 };
            }
            if (tr.docChanged) {
              return { decoration: DecorationSet.empty, suggestion: null, from: 0 };
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
              if (!options.enabled()) return;
              if (view.composing) return;
              if (view.state.doc.eq(prevState.doc) && view.state.selection.eq(prevState.selection)) {
                return;
              }

              debounced.cancel();

              const { selection } = view.state;
              if (!selection.empty) return;

              const $pos = selection.$from;
              const atBlockEnd = $pos.parent.isTextblock && $pos.parentOffset === $pos.parent.content.size;
              if (!atBlockEnd) return;

              const cursorPos = selection.from;
              const { before, after } = completionContext(view, cursorPos);
              const { words, cjkChars } = countWords(before);
              if (words + cjkChars < MIN_CONTEXT_UNITS) return;

              debounced.schedule(async (isCurrent) => {
                let suggestion: string;
                try {
                  suggestion = await invoke<string>("ai_complete", {
                    provider: options.provider(),
                    before,
                    after,
                  });
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
                if (!view.hasFocus() || view.state.selection.from !== cursorPos) return;
                if (view.composing) return; // mid-IME - dispatching now would break the composition

                const decoration = Decoration.widget(
                  cursorPos,
                  () => {
                    const span = document.createElement("span");
                    span.className = "ghost-text";
                    span.textContent = suggestion;
                    span.contentEditable = "false";
                    return span;
                  },
                  { side: 1 },
                );

                view.dispatch(
                  view.state.tr.setMeta(ghostTextKey, {
                    type: "set",
                    decoration: DecorationSet.create(view.state.doc, [decoration]),
                    suggestion,
                    from: cursorPos,
                  } satisfies GhostMeta),
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
