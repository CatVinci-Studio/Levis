import { useEffect, useRef } from "react";

/// Shared "click outside (or press Escape) to close" wiring for transient,
/// position:fixed overlays (context menu, inline chat bar) - attach the
/// returned ref to the overlay's root element. Listens in the capture phase
/// after a tick so the click/keypress that opened the overlay doesn't also
/// immediately close it.
export function useCloseOnOutsideClick<T extends HTMLElement>(onClose: () => void, closeOnEscape = false) {
  const ref = useRef<T>(null);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
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
  }, [onClose, closeOnEscape]);

  return ref;
}
