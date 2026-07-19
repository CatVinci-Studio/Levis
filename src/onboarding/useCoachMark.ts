import { useCallback, useEffect, useState } from "react";
import {
  isCoachMarkSeen,
  markCoachMarkSeen,
  type CoachMarkId,
} from "./coach-marks";

// Module-level, not React state: guarantees at most one coach mark is
// visible at a time across the whole app - whichever qualifying action
// happens first claims it, a second one within the same window is silently
// skipped rather than stacking bubbles.
let activeMark: CoachMarkId | null = null;

/**
 * A coach mark the caller triggers imperatively (e.g. on the mouseup that
 * follows a big enough text selection), not one that shows itself on
 * mount - that's what keeps a fresh document from opening with a bubble
 * already up. `trigger()` is a no-op once this id has been seen or another
 * mark already has the floor.
 */
export function useCoachMark(id: CoachMarkId) {
  const [visible, setVisible] = useState(false);

  // Closing the tab while its bubble is visible used to leave the
  // module-level lock occupied forever, preventing every later coach mark
  // in the window. Releasing ownership on unmount keeps "one at a time"
  // without turning it into "only one for the lifetime of the app".
  useEffect(
    () => () => {
      if (activeMark === id) activeMark = null;
    },
    [id],
  );

  const trigger = useCallback(() => {
    if (isCoachMarkSeen(id) || activeMark !== null) return;
    activeMark = id;
    setVisible(true);
  }, [id]);

  const dismiss = useCallback(() => {
    markCoachMarkSeen(id);
    if (activeMark === id) activeMark = null;
    setVisible(false);
  }, [id]);

  return { visible, trigger, dismiss };
}
