import { useEffect, useRef } from "react";

/// Shared "click outside (or press Escape) to close" wiring for transient
/// overlays (menus, popovers) - attach the returned ref to the element that
/// holds both the overlay and the control that opens it. Listens in the
/// capture phase after a tick so the click/keypress that opened the overlay
/// doesn't also immediately close it.
///
/// `open` must say whether the overlay is showing: a component that stays
/// mounted with its menu closed (the AI panel's project bar, the Windows
/// menu button) otherwise kept swallowing every Escape in the window.
export function useCloseOnOutsideClick<T extends HTMLElement>(
  onClose: () => void,
  closeOnEscape = false,
  open = true,
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      // A Select's open list is portalled to <body>; picking from it is
      // still a click inside whatever holds the Select.
      if (target instanceof Element && target.closest("[data-floating-select]"))
        return;
      if (ref.current && !ref.current.contains(target)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key !== "Escape") return;
      // One Escape closes one thing: the overlay, not also the find bar
      // (whose listener sits on window, after this one on document).
      e.stopPropagation();
      onClose();
    }
    const id = setTimeout(() => {
      document.addEventListener("mousedown", onPointerDown, true);
      if (closeOnEscape) document.addEventListener("keydown", onKeyDown);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", onPointerDown, true);
      if (closeOnEscape) document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, closeOnEscape, open]);

  return ref;
}
