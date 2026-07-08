import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { invoke } from "@tauri-apps/api/core";

const grammarKey = new PluginKey("grammar-check");
const DEBOUNCE_MS = 1500;
const MIN_PARAGRAPH_CHARS = 12;

interface GrammarIssue {
  start: number;
  end: number;
  issue: string;
  suggestion: string;
}

export function createGrammarCheckPlugin(options: { enabled: () => boolean; provider: () => string }) {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let requestSeq = 0;

  return $prose(
    () =>
      new Plugin<DecorationSet>({
        key: grammarKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, prev) {
            const meta = tr.getMeta(grammarKey) as DecorationSet | undefined;
            if (meta) return meta;
            if (tr.docChanged) return prev.map(tr.mapping, tr.doc);
            return prev;
          },
        },
        props: {
          decorations(state) {
            return grammarKey.getState(state);
          },
        },
        view() {
          return {
            update(view, prevState) {
              if (!options.enabled()) return;
              if (view.composing) return;
              if (view.state.doc.eq(prevState.doc)) return;
              if (debounceTimer) clearTimeout(debounceTimer);

              const { $from } = view.state.selection;
              const para = $from.parent;
              if (!para.isTextblock) return;

              const text = para.textContent;
              if (text.trim().length < MIN_PARAGRAPH_CHARS) return;

              const contentStart = $from.start($from.depth);
              const mySeq = ++requestSeq;

              debounceTimer = setTimeout(async () => {
                let issues: GrammarIssue[];
                try {
                  issues = await invoke<GrammarIssue[]>("ai_grammar_check", {
                    provider: options.provider(),
                    paragraph: text,
                  });
                } catch {
                  return; // not logged in, offline, or bad model output - fail silently
                }
                if (mySeq !== requestSeq) return;
                if (!view.hasFocus()) return;
                if (!issues?.length) return;

                const decorations = issues.map((issue) =>
                  Decoration.inline(contentStart + issue.start, contentStart + issue.end, {
                    class: "grammar-issue",
                    title: `${issue.issue}\n→ ${issue.suggestion}`,
                  }),
                );

                view.dispatch(
                  view.state.tr.setMeta(grammarKey, DecorationSet.create(view.state.doc, decorations)),
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
