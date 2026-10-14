import { useEffect, useRef, type KeyboardEvent } from "react";
import { usePhoneLayout } from "../mobile/usePhoneLayout";

// `summary` is a <details> toggle: without it Settings' folded Advanced
// group can't be reached by Tab - the wrap goes back to the close button.
const FOCUSABLE =
  ':is(button, input, select, textarea, summary, a[href], [tabindex]):not(:disabled):not([tabindex="-1"]):not([type="hidden"])';

/** Shared focus lifecycle for modal dialogs; callers provide role and label.
 *  `refocusEditorOnPhone: false` leaves the keyboard down on a phone when
 *  the dialog closes, instead of handing the focus back to the editor. */
export function useModalDialog(
  onClose: () => void,
  enabled = true,
  initialFocusSelector?: string,
  refocusEditorOnPhone = true,
) {
  const ref = useRef<HTMLDivElement>(null);
  const phone = usePhoneLayout();
  useEffect(() => {
    if (!enabled) return;
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement;
    let first =
      (initialFocusSelector
        ? dialog.querySelector<HTMLElement>(initialFocusSelector)
        : null) ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
    // On a phone a button is pressed, not focused: nothing iOS draws
    // starts with one, and a focused button only waits for an Enter no
    // one will type. A text field still takes the focus - the keyboard
    // coming up is what the dialog is asking for.
    if (phone && first && !first.matches("input, textarea")) first = null;
    (first ?? dialog).focus();
    return () => {
      if (!(previous instanceof HTMLElement) || !previous.isConnected) return;
      // On a phone, focusing the editor again brings the keyboard back up.
      // After Settings that covers a page the user only meant to return to;
      // after inserting a table it is where they go on typing, so only the
      // caller can say.
      if (phone && !refocusEditorOnPhone && previous.isContentEditable) return;
      previous.focus();
    };
  }, [enabled, initialFocusSelector, phone, refocusEditorOnPhone]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!enabled) return;
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
      return;
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    if (event.key !== "Tab" || event.defaultPrevented) return;
    const elements = Array.from(
      ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    ).filter(
      (el) =>
        !el.closest('[hidden], [inert], [aria-hidden="true"]') &&
        // A folded <details> still has its controls in the DOM, unrendered:
        // counting one as "last" would stop the wrap after its summary.
        !el.closest("details:not([open]) > :not(summary)") &&
        getComputedStyle(el).display !== "none" &&
        getComputedStyle(el).visibility !== "hidden",
    );
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (!first) {
      event.preventDefault();
      ref.current?.focus();
    } else if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === ref.current)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  return { ref, onKeyDown, tabIndex: -1 };
}
