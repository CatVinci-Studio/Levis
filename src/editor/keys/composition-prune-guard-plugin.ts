import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

// WebKitGTK commits an IME composition in two steps: it deletes the preedit
// (inputType deleteCompositionText), then inserts the committed text
// (insertFromComposition). When the preedit was all an item held - the
// first word typed into a fresh list or task item - WebKit's delete prunes
// the emptied <p> AND its <li> out of the DOM, leaving a bare <br> in the
// list. The committed text then lands outside any item, and once
// ProseMirror reads the DOM back the line has split into an empty item
// followed by one holding the text (a task item also loses its checkbox
// state). A plain paragraph keeps a placeholder <br> and is unaffected; no
// list styling changes the pruning.
//
// The events can't be cancelled, but the `input` for the delete fires
// before the insert. So the ancestors of the composition are noted on
// `beforeinput`, and if the delete detached them they're put back - the
// same elements, so ProseMirror's view of them stays valid - with the caret
// inside the textblock, where the insert then goes.

interface Link {
  node: Node;
  parent: Node;
  prev: Node | null;
  next: Node | null;
}

/** The composition's textblock and its ancestors up to the editor root,
 *  innermost first. */
function ancestry(view: EditorView): Link[] {
  const selection = view.dom.ownerDocument.getSelection();
  let node: Node | null = selection?.anchorNode ?? null;
  if (node?.nodeType === Node.TEXT_NODE) node = node.parentNode;
  const links: Link[] = [];
  while (node && node !== view.dom && node.parentNode) {
    links.push({
      node,
      parent: node.parentNode,
      prev: node.previousSibling,
      next: node.nextSibling,
    });
    node = node.parentNode;
  }
  return node === view.dom ? links : [];
}

/** Puts `link.node` back between its old siblings, dropping whatever the
 *  delete left in its place (WebKit's placeholder <br>). */
function reattach({ node, parent, prev, next }: Link) {
  const start =
    prev?.parentNode === parent ? prev.nextSibling : parent.firstChild;
  const end = next?.parentNode === parent ? next : null;
  for (let child = start; child && child !== end;) {
    const following = child.nextSibling;
    if (
      child.nodeName === "BR" ||
      (child.nodeType === Node.TEXT_NODE && !child.textContent)
    )
      parent.removeChild(child);
    child = following;
  }
  parent.insertBefore(node, end);
}

export function restorePrunedComposition(view: EditorView, links: Link[]) {
  const block = links[0]?.node;
  if (!block || block.isConnected) return false;
  // Outermost first, so each level goes back into an attached parent.
  for (let i = links.length - 1; i >= 0; i--) {
    if (links[i].node.parentNode !== links[i].parent) reattach(links[i]);
  }
  if (!block.isConnected) return false;
  // WebKit detached the subtree with the preedit still in it. Only an
  // item whose whole content was the preedit gets pruned (anything else
  // would still render), so this empties it exactly as the delete meant to.
  // The <br> is the placeholder WebKit itself leaves in an emptied
  // paragraph: without it the block has no line box, the caret can't sit
  // in it and the insert goes to the end of the previous block instead.
  (block as Element).replaceChildren(document.createElement("br"));
  view.dom.ownerDocument.getSelection()?.collapse(block, 0);
  return true;
}

export const compositionPruneGuardPlugin = $prose(() => {
  let links: Link[] = [];
  return new Plugin({
    props: {
      handleDOMEvents: {
        beforeinput(view, event) {
          if (event.inputType === "deleteCompositionText")
            links = ancestry(view);
          return false;
        },
        input(view, event) {
          if ((event as InputEvent).inputType !== "deleteCompositionText")
            return false;
          restorePrunedComposition(view, links);
          links = [];
          return false;
        },
      },
    },
  });
});
