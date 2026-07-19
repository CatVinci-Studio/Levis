import { useCallback } from "react";
import { useInstance } from "@milkdown/react";
import type { Ctx } from "@milkdown/kit/ctx";

/** Runs a function against the editor Ctx; undefined while still loading. */
export type EditorRunner = <T>(fn: (ctx: Ctx) => T) => T | undefined;

/**
 * The single way this app touches the editor imperatively. Every menu
 * item, shortcut, and popover action is a plain function over the editor
 * Ctx, and the hooks that provide those actions (useEditorClipboard,
 * useAiActions, ...) compose on this runner instead of each reaching for
 * useInstance themselves.
 */
export function useEditorRunner(): EditorRunner {
  const [loading, getEditor] = useInstance();
  return useCallback(
    <T>(fn: (ctx: Ctx) => T): T | undefined =>
      loading ? undefined : getEditor().action(fn),
    [loading, getEditor],
  );
}
