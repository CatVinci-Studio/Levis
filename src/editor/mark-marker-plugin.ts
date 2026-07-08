import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { MarkType } from "@milkdown/kit/prose/model";

const markMarkerKey = new PluginKey("mark-marker");

const MARK_SYNTAX: Record<string, string> = {
  strong: "**",
  emphasis: "*",
};

function makeMarkerSpan(text: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "mark-marker";
  span.textContent = text;
  span.contentEditable = "false";
  return span;
}

function collectRuns(state: EditorState, markType: MarkType): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let runStart: number | null = null;
  let runEnd = 0;

  state.doc.descendants((node, pos) => {
    if (!node.isText) {
      if (runStart !== null) {
        runs.push([runStart, runEnd]);
        runStart = null;
      }
      return;
    }
    if (markType.isInSet(node.marks)) {
      if (runStart === null) runStart = pos;
      runEnd = pos + node.nodeSize;
    } else if (runStart !== null) {
      runs.push([runStart, runEnd]);
      runStart = null;
    }
  });
  if (runStart !== null) runs.push([runStart, runEnd]);

  return runs;
}

function buildDecorations(state: EditorState): DecorationSet {
  const { selection } = state;
  const decorations: Decoration[] = [];

  for (const [markName, syntax] of Object.entries(MARK_SYNTAX)) {
    const markType = state.schema.marks[markName];
    if (!markType) continue;

    for (const [from, to] of collectRuns(state, markType)) {
      const cursorInside = selection.from <= to && selection.to >= from;
      if (!cursorInside) continue;

      decorations.push(
        Decoration.widget(from, () => makeMarkerSpan(syntax), { side: -1 }),
        Decoration.widget(to, () => makeMarkerSpan(syntax), { side: 1 }),
      );
    }
  }

  return DecorationSet.create(state.doc, decorations);
}

/**
 * Typora-style reveal: bold/italic render with no visible ** or * markers
 * normally, but show them (as muted, non-editable text) while the cursor is
 * anywhere inside that marked span, mirroring headingMarkerPlugin's
 * treatment of "# ".
 */
export const markMarkerPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: markMarkerKey,
      state: {
        init: (_config, state) => buildDecorations(state),
        apply(tr, prev, _oldState, newState) {
          if (!tr.docChanged && !tr.selectionSet) return prev;
          return buildDecorations(newState);
        },
      },
      props: {
        decorations(state) {
          return markMarkerKey.getState(state);
        },
      },
    }),
);
