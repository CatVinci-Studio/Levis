import { useCallback, useEffect, useRef } from "react";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { registerEditorFlush } from "../editor/editor-flush";
import type { EditorRunner } from "../editor/useEditorRunner";
import { useLatest } from "../utils/hooks/useLatest";

/** How one tab's editor hands its markdown to the tab: the listener's
 *  debounced reports, and the immediate flush App.tsx asks for. */
export interface DocumentReporting {
  reportedDocRef: { current: ProseNode | null };
  reportedMarkdownRef: { current: string | null };
  mountDocRef: { current: ProseNode | null };
  reportMarkdown: (ctx: Ctx, markdown: string) => void;
}

export function useDocumentReporting(
  initialValue: string,
  onChange: (markdown: string) => void,
): DocumentReporting {
  const onChangeRef = useLatest(onChange);
  // The doc and markdown last handed to onChange (or the mount-time doc),
  // for flushing an edit the listener's debounce still holds - see
  // editor-flush.ts.
  const reportedDocRef = useRef<ProseNode | null>(null);
  const reportedMarkdownRef = useRef<string | null>(null);
  // The file as it was opened, and what the editor would write for the doc
  // it parsed that into (computed the first time it is needed). A change
  // that serializes back to that same text - a plugin touching node attrs
  // on mount, an edit undone - is not an edit: the tab reports the file's
  // own text, so it stays clean and a save leaves the file byte-for-byte
  // as it was instead of rewriting it in the serializer's house style.
  const openedValueRef = useRef(initialValue);
  const mountDocRef = useRef<ProseNode | null>(null);
  const mountMarkdownRef = useRef<string | null>(null);
  const reportMarkdown = useCallback(
    (ctx: Ctx, markdown: string) => {
      const mountDoc = mountDocRef.current;
      if (mountDoc && mountMarkdownRef.current === null)
        mountMarkdownRef.current = ctx.get(serializerCtx)(mountDoc);
      const value =
        markdown === mountMarkdownRef.current
          ? openedValueRef.current
          : markdown;
      reportedMarkdownRef.current = value;
      onChangeRef.current(value);
    },
    [onChangeRef],
  );
  return { reportedDocRef, reportedMarkdownRef, mountDocRef, reportMarkdown };
}

/** Registers this editor's flush under its tab (see editor-flush.ts). */
export function useEditorFlush(
  tabId: string,
  run: EditorRunner,
  { reportedDocRef, reportedMarkdownRef, reportMarkdown }: DocumentReporting,
) {
  // The listener's debounce reports the same doc again later - a harmless
  // repeat of the markdown already handed over here.
  useEffect(
    () =>
      registerEditorFlush(
        tabId,
        () =>
          run((ctx) => {
            const { doc } = ctx.get(editorViewCtx).state;
            const reported = reportedDocRef.current;
            if (reported && !doc.eq(reported)) {
              reportedDocRef.current = doc;
              reportMarkdown(ctx, ctx.get(serializerCtx)(doc));
            }
            return reportedMarkdownRef.current;
          }) ?? null,
      ),
    [tabId, run, reportMarkdown, reportedDocRef, reportedMarkdownRef],
  );
}
