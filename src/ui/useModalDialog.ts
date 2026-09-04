import { useEffect, useRef, type KeyboardEvent } from "react";

const FOCUSABLE =
  ':is(button, input, select, textarea, a[href], [tabindex]):not(:disabled):not([tabindex="-1"]):not([type="hidden"])';

/** Shared focus lifecycle for modal dialogs; callers provide role and label. */
export function useModalDialog(
  onClose: () => void,
  enabled = true,
  initialFocusSelector?: string,
) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled) return;
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement;
    const first =
      (initialFocusSelector
        ? dialog.querySelector<HTMLElement>(initialFocusSelector)
        : null) ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog).focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [enabled, initialFocusSelector]);

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
