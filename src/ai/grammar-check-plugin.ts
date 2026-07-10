import type { EditorView } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { invoke } from "@tauri-apps/api/core";
import { createDebouncedTask } from "./debounced-task";
import { textOffsetToDocPos } from "./doc-text";

export const grammarKey = new PluginKey("grammar-check");
const DEBOUNCE_MS = 1500;
const MIN_PARAGRAPH_CHARS = 12;

interface GrammarIssue {
  start: number;
  end: number;
  issue: string;
  suggestion: string;
}

/// Runs a grammar check right now on the paragraph the cursor is in,
/// bypassing the debounce/length gating the typing-triggered path uses - for
/// manual "trigger grammar check" entry points (e.g. a context menu item).
/// Unlike the silent auto-trigger path, this throws on failure so the caller
/// can surface the error to the user.
export async function triggerGrammarCheckNow(view: EditorView, provider: string): Promise<void> {
  const { $from } = view.state.selection;
  const para = $from.parent;
  if (!para.isTextblock) throw new Error("Place the cursor in a paragraph first.");

  const text = para.textContent;
  if (!text.trim()) throw new Error("This paragraph is empty.");

  const contentStart = $from.start($from.depth);
  const issues = await invoke<GrammarIssue[]>("ai_grammar_check", { provider, paragraph: text });
  if (!issues?.length) throw new Error("No issues found.");

  view.dispatch(
    view.state.tr.setMeta(
      grammarKey,
      DecorationSet.create(view.state.doc, issuesToDecorations(para, issues, contentStart)),
    ),
  );
}

/// The hover popover (rendered in MilkdownEditor) reads `issue`/`suggestion`
/// back off the decoration's spec rather than a DOM `title` attribute, so it
/// can render a real "Apply" button instead of relying on the OS tooltip.
export interface GrammarDecorationSpec {
  issue: string;
  suggestion: string;
}

function issuesToDecorations(para: ProseNode, issues: GrammarIssue[], contentStart: number): Decoration[] {
  const decorations: Decoration[] = [];
  for (const issue of issues) {
    const from = textOffsetToDocPos(para, contentStart, issue.start);
    const to = textOffsetToDocPos(para, contentStart, issue.end);
    if (from === null || to === null || from >= to) continue; // range the model made up - drop it
    decorations.push(
      Decoration.inline(
        from,
        to,
        { class: "grammar-issue" },
        { issue: issue.issue, suggestion: issue.suggestion } satisfies GrammarDecorationSpec,
      ),
    );
  }
  return decorations;
}

export function createGrammarCheckPlugin(options: { enabled: () => boolean; provider: () => string }) {
  const debounced = createDebouncedTask(DEBOUNCE_MS);

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
              debounced.cancel();

              const { $from } = view.state.selection;
              const para = $from.parent;
              if (!para.isTextblock) return;

              const text = para.textContent;
              if (text.trim().length < MIN_PARAGRAPH_CHARS) return;

              const contentStart = $from.start($from.depth);

              debounced.schedule(async (isCurrent) => {
                let issues: GrammarIssue[];
                try {
                  issues = await invoke<GrammarIssue[]>("ai_grammar_check", {
                    provider: options.provider(),
                    paragraph: text,
                  });
                } catch (err) {
                  // Not logged in, offline, or bad model output - stays quiet in
                  // the UI (no error popup while you're just typing), but still
                  // logged so it's diagnosable instead of vanishing entirely.
                  console.error("[grammar-check] request failed:", err);
                  return;
                }
                if (!isCurrent()) return;
                if (!view.hasFocus()) return;
                if (!issues?.length) return;

                view.dispatch(
                  view.state.tr.setMeta(
                    grammarKey,
                    DecorationSet.create(view.state.doc, issuesToDecorations(para, issues, contentStart)),
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
