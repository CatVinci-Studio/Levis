import { useCallback } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import { triggerGhostTextNow } from "./ghost-text-plugin";
import { triggerGrammarCheckNow } from "./grammar-check-plugin";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { AiProvider } from "../settings/SettingsContext";

export interface AiActions {
  triggerCompletion: () => void;
  triggerGrammarCheck: () => void;
}

/**
 * On-demand AI triggers (menu items / keyboard shortcuts), as opposed to
 * the passive typing-driven runs the ghost-text and grammar plugins do on
 * their own. `getProvider` is a getter, not a value, so the actions built
 * once here always use the provider currently selected in settings.
 */
export function useAiActions(run: EditorRunner, getProvider: () => AiProvider): AiActions {
  const triggerCompletion = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      triggerGhostTextNow(view, getProvider()).catch((err) => alert(String(err?.message ?? err)));
    });
  }, [run, getProvider]);

  const triggerGrammarCheck = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      triggerGrammarCheckNow(view, getProvider()).catch((err) => alert(String(err?.message ?? err)));
    });
  }, [run, getProvider]);

  return { triggerCompletion, triggerGrammarCheck };
}
