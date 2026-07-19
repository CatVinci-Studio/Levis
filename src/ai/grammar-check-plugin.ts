import type { EditorView } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { createDebouncedTask } from "./debounced-task";
import { scalarToUtf16Offset, textOffsetToDocPos } from "./doc-text";
import { isLargeDoc } from "../editor/large-doc";
import { ai } from "../ipc";

export const grammarKey = new PluginKey("grammar-check");
const DEBOUNCE_MS = 1500;
const MIN_PARAGRAPH_CHARS = 12;

export interface GrammarIssue {
  /** Unicode-scalar offsets into the checked paragraph (backend-verified). */
  start: number;
  end: number;
  issue: string;
  suggestion: string;
  /** Exact text of the span - re-verified before decorating and applying. */
  original?: string;
}

/**
 * The checked paragraph, as it was at request time. The response is only
 * usable if the paragraph still reads exactly the same - an IME composition
 * (view.composing suppresses rescheduling) or fast typing can change it
 * while the request is in flight, and applying offsets computed against the
 * old text is how fixes used to land beside the text they meant to replace.
 */
function paragraphUnchanged(
  view: EditorView,
  contentStart: number,
  text: string,
): boolean {
  try {
    const $pos = view.state.doc.resolve(contentStart);
    return $pos.parent.isTextblock && $pos.parent.textContent === text;
  } catch {
    return false; // position no longer exists
  }
}

/// Runs a grammar check right now on the paragraph the cursor is in,
/// bypassing the debounce/length gating the typing-triggered path uses - for
/// manual "trigger grammar check" entry points (e.g. a context menu item).
/// Unlike the silent auto-trigger path, this throws on failure so the caller
/// can surface the error to the user.
export async function triggerGrammarCheckNow(
  view: EditorView,
  provider: string,
  strictness: string,
  model: string | null,
): Promise<void> {
  const { $from } = view.state.selection;
  const para = $from.parent;
  if (!para.isTextblock)
    throw new Error("Place the cursor in a paragraph first.");

  const text = para.textContent;
  if (!text.trim()) throw new Error("This paragraph is empty.");

  const contentStart = $from.start($from.depth);
  const issues = await ai.grammarCheck(provider, text, strictness, model);
  if (!paragraphUnchanged(view, contentStart, text)) {
    throw new Error("The paragraph changed while checking - try again.");
  }
  if (!issues?.length) throw new Error("No issues found.");

  view.dispatch(
    view.state.tr.setMeta(
      grammarKey,
      DecorationSet.create(
        view.state.doc,
        issuesToDecorations(para, issues, contentStart),
      ),
    ),
  );
}

/// Underlines a PRE-WRITTEN set of issues in the cursor's paragraph - the
/// decoration half of triggerGrammarCheckNow above, without the backend
/// call. Used by the onboarding tutorial's grammar step, which has no AI
/// account to call yet.
export function showGrammarIssues(
  view: EditorView,
  issues: GrammarIssue[],
): void {
  const { $from } = view.state.selection;
  const para = $from.parent;
  if (!para.isTextblock) return;
  const contentStart = $from.start($from.depth);
  view.dispatch(
    view.state.tr.setMeta(
      grammarKey,
      DecorationSet.create(
        view.state.doc,
        issuesToDecorations(para, issues, contentStart),
      ),
    ),
  );
}

/// The hover popover (rendered in MilkdownEditor) reads `issue`/`suggestion`
/// back off the decoration's spec rather than a DOM `title` attribute, so it
/// can render a real "Apply" button instead of relying on the OS tooltip.
export interface GrammarDecorationSpec {
  issue: string;
  suggestion: string;
  /** What the highlighted range must still say for Apply to act (see useGrammarPopover). */
  original?: string;
}

function issuesToDecorations(
  para: ProseNode,
  issues: GrammarIssue[],
  contentStart: number,
): Decoration[] {
  const text = para.textContent;
  const decorations: Decoration[] = [];
  // Left-to-right with overlaps dropped: stacked highlights on the same text
  // render as one visual range whose hover popover only ever shows found[0],
  // so the extra issues would be unreachable noise anyway.
  const ordered = [...issues].sort((a, b) => a.start - b.start);
  let lastEnd = -1;
  for (const issue of ordered) {
    if (issue.start < lastEnd) continue;
    // Backend offsets count Unicode scalars; JS strings (and ProseMirror
    // text offsets) count UTF-16 units.
    const start16 = scalarToUtf16Offset(text, issue.start);
    const end16 = scalarToUtf16Offset(text, issue.end);
    if (
      issue.original !== undefined &&
      text.slice(start16, end16) !== issue.original
    )
      continue;
    const from = textOffsetToDocPos(para, contentStart, start16);
    const to = textOffsetToDocPos(para, contentStart, end16);
    if (from === null || to === null || from >= to) continue; // range the model made up - drop it
    lastEnd = issue.end;
    decorations.push(
      Decoration.inline(from, to, { class: "grammar-issue" }, {
        issue: issue.issue,
        suggestion: issue.suggestion,
        original: issue.original,
      } satisfies GrammarDecorationSpec),
    );
  }
  return decorations;
}

export function createGrammarCheckPlugin(options: {
  enabled: () => boolean;
  provider: () => string;
  model: () => string | null;
  strictness: () => string;
}) {
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
            if (!tr.docChanged) return prev;
            // Mapping keeps positions in step with the edit; on top of that,
            // any highlight whose text no longer says what the issue was
            // about is done - applying a suggestion (or typing inside the
            // range) must clear its underline, not leave it hanging on the
            // corrected text.
            const mapped = prev.map(tr.mapping, tr.doc);
            const stale = mapped.find().filter((deco) => {
              const spec = deco.spec as GrammarDecorationSpec;
              return (
                spec.original !== undefined &&
                tr.doc.textBetween(deco.from, deco.to) !== spec.original
              );
            });
            return stale.length > 0 ? mapped.remove(stale) : mapped;
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
              if (isLargeDoc(view.state.doc)) return;
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
                  issues = await ai.grammarCheck(
                    options.provider(),
                    text,
                    options.strictness(),
                    options.model(),
                  );
                } catch (err) {
                  // Not logged in, offline, or bad model output - stays quiet in
                  // the UI (no error popup while you're just typing), but still
                  // logged so it's diagnosable instead of vanishing entirely.
                  console.error("[grammar-check] request failed:", err);
                  return;
                }
                if (!isCurrent()) return;
                if (!view.hasFocus()) return;
                if (view.composing) return; // mid-IME - offsets would go stale the moment it commits
                if (!paragraphUnchanged(view, contentStart, text)) return;
                if (!issues?.length) return;

                view.dispatch(
                  view.state.tr.setMeta(
                    grammarKey,
                    DecorationSet.create(
                      view.state.doc,
                      issuesToDecorations(para, issues, contentStart),
                    ),
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
