import { useCallback } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import { triggerGhostTextNow } from "./ghost-text-plugin";
import { triggerGrammarCheckNow } from "./grammar-check-plugin";
import { buildCompletionStyle } from "./completion-style";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { Settings } from "../settings/SettingsContext";

export interface AiActions {
  triggerCompletion: () => void;
  triggerGrammarCheck: () => void;
}

/**
 * On-demand AI triggers (menu items / keyboard shortcuts), as opposed to
 * the passive typing-driven runs the ghost-text and grammar plugins do on
 * their own. `getSettings` is a getter, not a value, so the actions built
 * once here always use the provider currently selected in settings.
 * Failures (including benign ones like "no issues found") go to `onNotice`
 * as a plain message - never a blocking dialog, these fire mid-typing.
 */
export function useAiActions(
  run: EditorRunner,
  getSettings: () => Settings,
  onNotice: (message: string) => void,
): AiActions {
  const triggerCompletion = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { aiProvider, completionTone, writingModels } = getSettings();
      const style = buildCompletionStyle(completionTone);
      triggerGhostTextNow(
        view,
        aiProvider,
        style,
        writingModels[aiProvider] || null,
      ).catch((err) => onNotice(String(err?.message ?? err)));
    });
  }, [run, getSettings, onNotice]);

  const triggerGrammarCheck = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { aiProvider, grammarStrictness, writingModels } = getSettings();
      triggerGrammarCheckNow(
        view,
        aiProvider,
        grammarStrictness,
        writingModels[aiProvider] || null,
      ).catch((err) => onNotice(String(err?.message ?? err)));
    });
  }, [run, getSettings, onNotice]);

  return { triggerCompletion, triggerGrammarCheck };
}
