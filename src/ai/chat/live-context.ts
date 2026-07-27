import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorRunner } from "../../editor/useEditorRunner";
import {
  documentMarkdown,
  readSelection,
  serializeBlocks,
} from "../doc-markdown";
import type { SelectionTarget } from "../usePendingEdits";
import type { ChatContext } from "./chat-bridge";

/**
 * The editor's state right now, as the detached chat window needs it.
 *
 * This is what makes the detached window the CROSS-FILE surface: it holds no
 * snapshot of its own, so whatever the active editor reports here is the
 * document it is about, the selection its chip shows, and the file its edits
 * land in. Contrast the in-document Quick Ask bar, which deliberately keeps
 * the snapshot taken when it opened (useInlineChat) - an inline command bar
 * that re-targeted itself mid-conversation would be unpredictable, while a
 * window the user keeps open beside their work is expected to follow along.
 *
 * Reading the whole document is not free (every top-level block is
 * re-serialized to markdown), which is why callers push this on selection,
 * tab and file changes - discrete user actions - and on demand before a
 * send, never on every keystroke.
 */
export interface LiveEditorState {
  /** What crosses the window boundary. */
  context: ChatContext;
  /** The selection, in THIS window's coordinates - ProseMirror positions mean
   *  nothing in another one. This is what a `replace_selection` proposal
   *  coming back from the chat targets, so it has to be remembered here at
   *  the moment the selection is sent. */
  selection: SelectionTarget;
}

/**
 * The document's markdown, cached against the ProseMirror doc it came from.
 *
 * ProseMirror documents are immutable, so `doc === lastDoc` is an O(1) exact
 * test for "nothing to re-serialize" - and during the gesture this whole
 * feature exists for, drag-selecting a passage, the document does not change
 * at all while the selection changes on every mousemove. Without the cache
 * each of those re-ran the serializer once per top-level block. A WeakMap so
 * a superseded doc is collectable the moment nothing else holds it.
 */
const documentCache = new WeakMap<ProseNode, string>();

function cachedDocumentMarkdown(ctx: Ctx, doc: ProseNode): string {
  const cached = documentCache.get(doc);
  if (cached !== undefined) return cached;
  const markdown = documentMarkdown(serializeBlocks(ctx, doc));
  documentCache.set(doc, markdown);
  return markdown;
}

export function readChatContext(
  run: EditorRunner,
  filePath: string | null,
  /** The tab's display name, from `tabTitle` - passed in rather than derived
   *  from `filePath`, because a Help doc has no path and would otherwise
   *  show as "Untitled" in the chat window. */
  docTitle: string,
  editorLabel: string,
): LiveEditorState | null {
  return (
    run((ctx) => {
      const { state } = ctx.get(editorViewCtx);
      const { selectedText, selectionMarkdown, range } = readSelection(
        ctx,
        state,
      );
      return {
        context: {
          document: cachedDocumentMarkdown(ctx, state.doc),
          selectedText,
          selectionMarkdown,
          docPath: filePath,
          docTitle,
          editorLabel,
        },
        // The same markdown the chat was shown, so the staleness check a
        // replace_selection proposal runs later compares like with like.
        selection: { range, selectionMarkdown },
      } satisfies LiveEditorState;
    }) ?? null
  );
}
