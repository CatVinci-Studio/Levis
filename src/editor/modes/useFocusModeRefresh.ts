import { useCallback, useEffect } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../useEditorRunner";
import { useWindowEvent } from "../../utils/hooks/useWindowEvent";
import { ZEN_MODE_EVENT } from "../../utils/events";

/** Typewriter and zen focus are drawn from editor state, but toggled from
 *  outside it: an empty transaction makes their plugins recompute (centre
 *  now, dim now) instead of waiting for the next keystroke. */
export function useFocusModeRefresh(
  run: EditorRunner,
  isActive: boolean,
  typewriterMode: boolean,
) {
  const refreshEditor = useCallback(
    () =>
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.setMeta("textus-refresh", true));
      }),
    [run],
  );
  useEffect(() => {
    if (isActive) refreshEditor();
  }, [typewriterMode, isActive, refreshEditor]);
  useWindowEvent(ZEN_MODE_EVENT, () => {
    if (isActive) refreshEditor();
  });
}
