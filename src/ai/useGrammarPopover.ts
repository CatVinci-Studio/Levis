import { useCallback, useRef, useState, type MouseEvent } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Decoration } from "@milkdown/kit/prose/view";
import { grammarKey, type GrammarDecorationSpec } from "./grammar-check-plugin";
import { findUniqueTextRange } from "./doc-text";
import type { GrammarPopoverInfo } from "./GrammarPopover";
import type { EditorRunner } from "../editor/useEditorRunner";

/**
 * Hover behavior for grammar-issue highlights: moving onto a highlighted
 * range looks up its decoration and opens the popover under it; moving off
 * hides it on a short delay so the pointer can travel into the popover
 * itself (cancelHide keeps it open while hovered).
 */
export function useGrammarPopover(run: EditorRunner, getStaleMessage: () => string) {
  const [popover, setPopover] = useState<GrammarPopoverInfo | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onMouseOver = useCallback(
    (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest?.(".grammar-issue") as HTMLElement | null;
      if (!target) return;
      if (hideTimer.current) clearTimeout(hideTimer.current);

      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const pos = view.posAtDOM(target, 0);
        const found = grammarKey.getState(view.state)?.find(pos, pos + 1) ?? [];
        const deco = found[0];
        if (!deco) return;
        const spec = deco.spec as GrammarDecorationSpec;
        const rect = target.getBoundingClientRect();
        setApplyError(null);
        setPopover({
          x: rect.left,
          y: rect.bottom + 6,
          from: deco.from,
          to: deco.to,
          issue: spec.issue,
          suggestion: spec.suggestion,
          original: spec.original,
        });
      });
    },
    [run],
  );

  const onMouseOut = useCallback((e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest?.(".grammar-issue");
    if (!target) return;
    const related = e.relatedTarget as HTMLElement | null;
    if (related?.closest?.(".grammar-popover")) return;
    hideTimer.current = setTimeout(() => setPopover(null), 150);
  }, []);

  const cancelHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  const hide = useCallback(() => {
    setPopover(null);
    setApplyError(null);
  }, []);

  const applyFix = useCallback(() => {
    if (!popover) return;
    const { suggestion, original } = popover;
    let applied = false;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;

      // The hover-time from/to go stale the moment the document is edited,
      // so re-resolve the target now. First choice: the live decoration for
      // this issue - the plugin maps decorations through edits and drops the
      // ones whose text changed, so a surviving one is trustworthy.
      const live = (grammarKey.getState(state)?.find() ?? []).find((deco: Decoration) => {
        const spec = deco.spec as GrammarDecorationSpec;
        return spec.original === original && spec.suggestion === suggestion;
      });
      let range = live ? { from: live.from, to: live.to } : null;

      // No live decoration (e.g. it was cleared with the whole set) - the
      // text itself is still a valid target if it occurs exactly once.
      if (!range && original) range = findUniqueTextRange(state.doc, original);

      // Last line of defense against replacing the wrong text: the range
      // must still say exactly what the model was fixing.
      if (!range || (original !== undefined && state.doc.textBetween(range.from, range.to) !== original)) {
        return;
      }
      view.dispatch(state.tr.insertText(suggestion, range.from, range.to));
      view.focus();
      applied = true;
    });
    if (applied) {
      setPopover(null);
      setApplyError(null);
    } else {
      // Leave the popover up with an explanation - a silently dead Apply
      // button reads as a broken feature.
      setApplyError(getStaleMessage());
    }
  }, [popover, run, getStaleMessage]);

  return { popover, applyError, onMouseOver, onMouseOut, cancelHide, hide, applyFix };
}
