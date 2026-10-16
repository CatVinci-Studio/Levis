import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

// WebKit (WebKitGTK here, Safari too) commits an IME composition in two
// steps: it deletes the preedit (inputType deleteCompositionText), then
// inserts the committed text (insertFromComposition). When the delete
// leaves a positioned element empty it removes that element (ProseMirror
// #934): with the first word typed into a fresh list item that took the
// <p> and the <li>, and the line split into an empty item plus one with
// the text. List items are no longer positioned (milkdown-theme.css), so
// for them this never fires; table cells have to be - the column-resize
// handle sits on them - and lose their <p> the same way.
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
 *  delete left in its place: WebKit's placeholder <br>, and in a table row
 *  an empty stand-in for the cell it took out. */
function reattach({ node, parent, prev, next }: Link) {
  const start =
    prev?.parentNode === parent ? prev.nextSibling : parent.firstChild;
  const end = next?.parentNode === parent ? next : null;
  for (let child = start; child && child !== end;) {
    const following = child.nextSibling;
    const placeholder =
      child.nodeName === "BR" ||
      (child.nodeType === Node.TEXT_NODE && !child.textContent) ||
      (child.nodeName === node.nodeName && !child.textContent);
    if (placeholder) parent.removeChild(child);
    child = following;
  }
  parent.insertBefore(node, end);
}

function restorePrunedComposition(view: EditorView, links: Link[]) {
  const block = links[0]?.node;
  if (!block || block.isConnected) return false;
  // Outermost first, so each level goes back into an attached parent.
  for (let i = links.length - 1; i >= 0; i--) {
    if (links[i].node.parentNode !== links[i].parent) reattach(links[i]);
  }
  // Where the delete took only the textblock (a table cell, positioned for
  // its resize handle, stays), WebKit puts its placeholder <br> beside the
  // ancestor instead - straight into the <tr>. A <br> that wasn't a
  // neighbour before the delete is that placeholder.
  for (const { node, prev, next } of links) {
    const before = node.previousSibling;
    if (before && before !== prev && before.nodeName === "BR") before.remove();
    const after = node.nextSibling;
    if (after && after !== next && after.nodeName === "BR") after.remove();
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

// Capture listeners on the window, not handleDOMEvents. The repair has to
// land before ProseMirror reacts to the pruning, and ProseMirror's
// MutationObserver callback runs as a microtask after EVERY listener the
// event passes - by the time a listener on the editor (or a plugin's
// handleDOMEvents) ran, ProseMirror had already redrawn the list around
// the hole. The window's capture phase is the first stop.
export const compositionPruneGuardPlugin = $prose(
  () =>
    new Plugin({
      view(view) {
        let links: Link[] = [];
        const onBeforeInput = (event: InputEvent) => {
          if (
            event.inputType === "deleteCompositionText" &&
            view.dom.contains(event.target as Node)
          )
            links = ancestry(view);
        };
        const onInput = (event: Event) => {
          if ((event as InputEvent).inputType !== "deleteCompositionText")
            return;
          restorePrunedComposition(view, links);
          links = [];
        };
        const win = view.dom.ownerDocument.defaultView ?? window;
        win.addEventListener("beforeinput", onBeforeInput, true);
        win.addEventListener("input", onInput, true);
        return {
          destroy() {
            win.removeEventListener("beforeinput", onBeforeInput, true);
            win.removeEventListener("input", onInput, true);
          },
        };
      },
    }),
);
