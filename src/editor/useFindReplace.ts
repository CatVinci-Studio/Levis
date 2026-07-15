import { useCallback, useEffect, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import { findReplaceKey } from "./find-replace-plugin";
import type { EditorRunner } from "./useEditorRunner";

export interface FindReplaceStatus {
  matchCount: number;
  activeIndex: number;
  error: boolean;
}

const IDLE_STATUS: FindReplaceStatus = { matchCount: 0, activeIndex: -1, error: false };

/** Owns the find & replace bar's open state and drives find-replace-plugin.ts via meta transactions. */
export function useFindReplace(run: EditorRunner) {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [status, setStatus] = useState<FindReplaceStatus>(IDLE_STATUS);

  const dispatchSearch = useCallback(
    (nextQuery: string, nextCaseSensitive: boolean, nextUseRegex: boolean) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(
          view.state.tr.setMeta(findReplaceKey, {
            type: "search",
            query: nextQuery,
            caseSensitive: nextCaseSensitive,
            useRegex: nextUseRegex,
          }),
        );
        const s = findReplaceKey.getState(view.state);
        setStatus(s ? { matchCount: s.matches.length, activeIndex: s.activeIndex, error: s.error } : IDLE_STATUS);
      });
    },
    [run],
  );

  const setQuery = useCallback(
    (value: string) => {
      setQueryState(value);
      dispatchSearch(value, caseSensitive, useRegex);
    },
    [dispatchSearch, caseSensitive, useRegex],
  );

  const toggleCaseSensitive = useCallback(() => {
    const next = !caseSensitive;
    setCaseSensitive(next);
    dispatchSearch(query, next, useRegex);
  }, [caseSensitive, dispatchSearch, query, useRegex]);

  const toggleUseRegex = useCallback(() => {
    const next = !useRegex;
    setUseRegex(next);
    dispatchSearch(query, caseSensitive, next);
  }, [useRegex, dispatchSearch, query, caseSensitive]);

  const scrollToActive = useCallback(
    (view: EditorView) => {
      const s = findReplaceKey.getState(view.state);
      const match = s?.matches[s.activeIndex];
      if (!match) return;
      try {
        const dom = view.domAtPos(match.from).node;
        const el = dom instanceof Element ? dom : dom.parentElement;
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch {
        // Position not representable in the DOM right now - not worth failing over.
      }
    },
    [],
  );

  const step = useCallback(
    (delta: 1 | -1) => {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        const s = findReplaceKey.getState(view.state);
        if (!s || s.matches.length === 0) return;
        const index = (s.activeIndex + delta + s.matches.length) % s.matches.length;
        view.dispatch(view.state.tr.setMeta(findReplaceKey, { type: "setActive", index }));
        setStatus({ matchCount: s.matches.length, activeIndex: index, error: s.error });
        scrollToActive(view);
      });
    },
    [run, scrollToActive],
  );

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  /** Regex mode re-applies the query's capture groups against the match's own text; plain mode is a literal swap. */
  function resolveReplacementText(matchText: string): string {
    if (!useRegex) return replacement;
    try {
      return matchText.replace(new RegExp(query, caseSensitive ? "" : "i"), replacement);
    } catch {
      return replacement;
    }
  }

  const replaceOne = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const s = findReplaceKey.getState(view.state);
      const match = s?.matches[s.activeIndex];
      if (!match) return;
      const text = resolveReplacementText(match.text);
      view.dispatch(view.state.tr.insertText(text, match.from, match.to));
      view.focus();
      const next2 = findReplaceKey.getState(view.state);
      setStatus(next2 ? { matchCount: next2.matches.length, activeIndex: next2.activeIndex, error: next2.error } : IDLE_STATUS);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, query, replacement, caseSensitive, useRegex]);

  const replaceAll = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const s = findReplaceKey.getState(view.state);
      if (!s || s.matches.length === 0) return;
      let tr = view.state.tr;
      // Reverse order so replacing one match never shifts the positions of matches still to come.
      for (let i = s.matches.length - 1; i >= 0; i--) {
        const match = s.matches[i];
        tr = tr.insertText(resolveReplacementText(match.text), match.from, match.to);
      }
      view.dispatch(tr);
      view.focus();
      const next2 = findReplaceKey.getState(view.state);
      setStatus(next2 ? { matchCount: next2.matches.length, activeIndex: next2.activeIndex, error: next2.error } : IDLE_STATUS);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, query, replacement, caseSensitive, useRegex]);

  const close = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta(findReplaceKey, { type: "clear" }));
      view.focus();
    });
    setOpen(false);
    setStatus(IDLE_STATUS);
  }, [run]);

  const toggle = useCallback(() => {
    if (open) {
      close();
    } else {
      setOpen(true);
      if (query) dispatchSearch(query, caseSensitive, useRegex);
    }
  }, [open, close, query, dispatchSearch, caseSensitive, useRegex]);

  // Escape closes the bar even when focus has moved to the editor (Replace/
  // Replace All refocus it) - the bar's own input-level Escape handlers only
  // fire while focus is still inside the bar.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  return {
    open,
    query,
    replacement,
    caseSensitive,
    useRegex,
    status,
    setQuery,
    setReplacement,
    toggleCaseSensitive,
    toggleUseRegex,
    next,
    prev,
    replaceOne,
    replaceAll,
    close,
    toggle,
  };
}

export type FindReplace = ReturnType<typeof useFindReplace>;
