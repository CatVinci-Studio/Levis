/**
 * Whether a review step - Next / Previous / Accept / Reject on a proposed
 * edit, or the first edit of a reply being revealed - puts the caret back
 * in the document after moving the selection to the edit.
 *
 * - Never out of a text field: when an edit arrives while the user is
 *   typing a follow-up, the rest of their message used to land in the
 *   document (and invalidate the very preview it jumped to).
 * - Never on a phone: a tapped button never holds focus there, so that
 *   check alone let every Next/Previous raise the keyboard over the AI
 *   sheet.
 * - On an iPad only when the editor had focus when the step began, i.e.
 *   the user was typing in the document (with a hardware keyboard, or the
 *   software one already up): focusing it otherwise raises the software
 *   keyboard over the document after every tap on Accept or Next.
 * - On the desktop always: the next keystroke belongs in the document.
 */
export function refocusAfterReview(state: {
  phone: boolean;
  /** The iOS app (here, with the phone excluded above: an iPad). */
  ios: boolean;
  /** The editor had focus when the step began. */
  editorHadFocus: boolean;
  /** A text field (the chat composer, a find bar) has focus now. */
  textFieldFocused: boolean;
}): boolean {
  if (state.textFieldFocused || state.phone) return false;
  if (state.ios) return state.editorHadFocus;
  return true;
}

/** How long a press counts as the start of the step it triggers: a tap's
 *  click follows its pointerdown well within this. */
export const PRESS_WINDOW_MS = 1500;

/**
 * Whether the editor had focus when the user started the current action:
 * it has it now, or it had it at the last press (pointerdown), recorded
 * because a tap can move the focus away before the button's click runs.
 */
export function editorFocusedBeforeAction(
  focusedNow: boolean,
  press: { focused: boolean; at: number } | null,
  now: number,
): boolean {
  if (focusedNow) return true;
  return !!press && press.focused && now - press.at < PRESS_WINDOW_MS;
}
