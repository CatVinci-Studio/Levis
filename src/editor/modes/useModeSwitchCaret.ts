import { useEffect } from "react";
import type { EditorRunner } from "../useEditorRunner";
import {
  applyEditorCaret,
  readEditorCaret,
  registerCaretReporter,
  takePendingCaret,
} from "./mode-switch";

/** Source/WYSIWYG switches keep the caret and scroll position
 *  (mode-switch.ts): while on screen this editor can report where its
 *  caret is, and on mounting it takes the caret the source view left. */
export function useModeSwitchCaret(
  run: EditorRunner,
  isActive: boolean,
  initialValue: string,
) {
  useEffect(() => {
    if (!isActive) return;
    return registerCaretReporter(
      (markdown) => run((ctx) => readEditorCaret(ctx, markdown)) ?? null,
    );
  }, [isActive, run]);
  const runReady = run(() => true) === true;
  useEffect(() => {
    if (!isActive || !runReady) return;
    const caret = takePendingCaret();
    if (!caret) return;
    // After layout, so coordinates for the scroll correction exist.
    requestAnimationFrame(() =>
      run((ctx) => applyEditorCaret(ctx, initialValue, caret)),
    );
    // Once per mount: the caret is handed across a single switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, runReady]);
}
