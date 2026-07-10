import type { Node } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

const placeholderKey = new PluginKey("empty-doc-placeholder");

function isDocEmpty(doc: Node): boolean {
  if (doc.childCount > 1) return false;
  const first = doc.firstChild;
  if (!first) return true;
  // Checking the node is still a plain paragraph (not just "no text yet")
  // matters because typing "# " converts it into an empty heading via an
  // input rule - that heading has zero content too, so a content-size-only
  // check would keep showing the placeholder (in the heading's oversized
  // font) even though the user clearly started writing.
  return first.type.name === "paragraph" && first.content.size === 0;
}

/// Shows a grayed-out hint in the first paragraph when the whole document is
/// empty - otherwise a brand-new/blank document just looks unopened, since
/// there's nothing on screen to show it's an editable WYSIWYG surface.
export function createPlaceholderPlugin(getPlaceholder: () => string) {
  return $prose(
    () =>
      new Plugin({
        key: placeholderKey,
        props: {
          decorations(state) {
            if (!isDocEmpty(state.doc)) return DecorationSet.empty;

            const node = state.doc.firstChild;
            if (!node) return DecorationSet.empty;

            return DecorationSet.create(state.doc, [
              Decoration.node(0, node.nodeSize, {
                class: "empty-doc-placeholder",
                "data-placeholder": getPlaceholder(),
              }),
            ]);
          },
        },
      }),
  );
}
