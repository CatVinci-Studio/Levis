import type { PendingPreview } from "./pending-edit-plugin";

/**
 * The previews a "review one at a time" flow can navigate: streaming ones
 * excluded (not decidable yet - see PendingPreview.streaming), ordered by
 * document position rather than arrival order, so "next" reads top to
 * bottom the way the user would scroll through the document themselves.
 */
export function orderForReview(previews: PendingPreview[]): PendingPreview[] {
  return previews
    .filter((p) => !p.streaming)
    .slice()
    .sort((a, b) => a.from - b.from);
}

/**
 * Where the review pointer should land after the navigable set changed
 * (a preview was accepted/rejected/settled/invalidated out of it).
 *
 * Keeps the pointer's POSITION rather than snapping back to the start: if
 * the focused item was at index 2 and it just left the list, the item now
 * AT index 2 (what used to be index 3, i.e. "the next one") becomes
 * focused - not index 0. Reviewing edits 3, 4, 5 in the middle of a longer
 * list must not restart the reader at edit 1 every time they decide on one.
 *
 * Still-focused items (found unchanged in `newOrder`) keep their id as-is.
 */
export function nextFocusAfterChange(
  oldOrder: string[],
  oldFocus: string | null,
  newOrder: string[],
): string | null {
  if (newOrder.length === 0) return null;
  if (oldFocus !== null && newOrder.includes(oldFocus)) return oldFocus;

  const oldIndex = oldFocus === null ? -1 : oldOrder.indexOf(oldFocus);
  if (oldIndex === -1) return newOrder[0];

  const clamped = Math.min(oldIndex, newOrder.length - 1);
  return newOrder[clamped];
}
