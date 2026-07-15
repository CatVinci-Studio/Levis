import { useEffect } from "react";

/**
 * Subscribes a handler to a window event. Deliberately re-attaches every
 * render (no dependency array) so the handler is always the current
 * closure - listeners wired once at mount would keep reading whatever
 * state they captured back then.
 */
export function useWindowEvent(name: string, handler: (e: Event) => void): void {
  useEffect(() => {
    window.addEventListener(name, handler);
    return () => window.removeEventListener(name, handler);
  });
}
