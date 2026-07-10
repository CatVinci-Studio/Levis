import { useCallback, useRef, useState, type MouseEvent } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import { grammarKey, type GrammarDecorationSpec } from "./grammar-check-plugin";
import type { GrammarPopoverInfo } from "./GrammarPopover";
import type { EditorRunner } from "../editor/useEditorRunner";

/**
 * Hover behavior for grammar-issue highlights: moving onto a highlighted
 * range looks up its decoration and opens the popover under it; moving off
 * hides it on a short delay so the pointer can travel into the popover
 * itself (cancelHide keeps it open while hovered).
 */
export function useGrammarPopover(run: EditorRunner) {
  const [popover, setPopover] = useState<GrammarPopoverInfo | null>(null);
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
        setPopover({
          x: rect.left,
          y: rect.bottom + 6,
          from: deco.from,
          to: deco.to,
          issue: spec.issue,
          suggestion: spec.suggestion,
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

  const hide = useCallback(() => setPopover(null), []);

  const applyFix = useCallback(() => {
    if (!popover) return;
    const { from, to, suggestion } = popover;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText(suggestion, from, to));
      view.focus();
    });
    setPopover(null);
  }, [popover, run]);

  return { popover, onMouseOver, onMouseOut, cancelHide, hide, applyFix };
}
