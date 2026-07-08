import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { invoke } from "@tauri-apps/api/core";
import { countWords } from "../utils/word-count";

// Below this much existing content, there isn't enough context for a decent
// suggestion (and it's more likely to feel intrusive on a near-empty doc).
const MIN_CONTEXT_UNITS = 20;
const DEBOUNCE_MS = 450;
const MAX_CONTEXT_CHARS = 2000;

const ghostTextKey = new PluginKey("ghost-text");

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
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let requestSeq = 0;

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

              if (debounceTimer) clearTimeout(debounceTimer);

              const { selection } = view.state;
              if (!selection.empty) return;

              const $pos = selection.$from;
              const atBlockEnd = $pos.parent.isTextblock && $pos.parentOffset === $pos.parent.content.size;
              if (!atBlockEnd) return;

              const fullText = view.state.doc.textBetween(0, view.state.doc.content.size, "\n\n");
              const { words, cjkChars } = countWords(fullText);
              if (words + cjkChars < MIN_CONTEXT_UNITS) return;

              const cursorPos = selection.from;
              const contextText = fullText.slice(Math.max(0, fullText.length - MAX_CONTEXT_CHARS));
              const mySeq = ++requestSeq;

              debounceTimer = setTimeout(async () => {
                let suggestion: string;
                try {
                  suggestion = await invoke<string>("ai_complete", {
                    provider: options.provider(),
                    context: contextText,
                  });
                } catch {
                  return; // not logged in, offline, or request failed - fail silently
                }
                if (mySeq !== requestSeq) return; // superseded by a newer trigger
                if (!suggestion?.trim()) return;
                if (!view.hasFocus() || view.state.selection.from !== cursorPos) return;

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
              }, DEBOUNCE_MS);
            },
            destroy() {
              if (debounceTimer) clearTimeout(debounceTimer);
            },
          };
        },
      }),
  );
}
