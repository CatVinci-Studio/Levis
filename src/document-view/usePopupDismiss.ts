import { useEffect } from "react";

/** Fixed-position popups are placed once, from where their anchor was:
 *  when the page moves under them (scroll, resize, the window losing
 *  focus) they'd point at the wrong text, so they close instead.
 *  A phone shows both as action sheets, which point at nothing - and
 *  closing them when the sheet's own list scrolls or the keyboard goes
 *  down would only lose them (the caller passes `anyPopup` false there). */
export function usePopupDismiss({
  anyPopup,
  setMenu,
  hideGrammar,
  settingsRef,
}: {
  anyPopup: boolean;
  /** The context menu's state setter (stable); called with null. */
  setMenu: (menu: null) => void;
  hideGrammar: () => void;
  settingsRef: { readonly current: { typewriterMode: boolean } };
}) {
  useEffect(() => {
    if (!anyPopup) return;
    const close = () => {
      setMenu(null);
      hideGrammar();
    };
    // Typewriter mode scrolls on every caret move - the very move that
    // opens the grammar popover - so there a scroll only closes the menu.
    // A long menu scrolls inside itself (a table's, on a short window);
    // that moves nothing it points at, so it stays open.
    const onScroll = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(".floating-surface"))
        return;
      setMenu(null);
      if (!settingsRef.current.typewriterMode) hideGrammar();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [anyPopup, setMenu, hideGrammar, settingsRef]);
}
