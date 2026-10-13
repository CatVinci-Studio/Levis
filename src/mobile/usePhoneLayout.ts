import { useSyncExternalStore } from "react";
import { isIOSApp } from "../platform/capabilities";

/** The width at which the iPhone layout takes over (ui/mobile.css): the
 *  sidebar becomes a drawer and Levis AI a bottom sheet. */
export const PHONE_QUERY = "(max-width: 760px)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia?.(PHONE_QUERY);
  mq?.addEventListener("change", onChange);
  return () => mq?.removeEventListener("change", onChange);
}

function snapshot() {
  return isIOSApp && (window.matchMedia?.(PHONE_QUERY).matches ?? false);
}

/** Whether surfaces should take their phone form - an action sheet rather
 *  than a menu at the finger, a full-screen page rather than a dialog. iOS
 *  at phone width only: an iPad keeps the desktop's popovers, as iPadOS
 *  apps do, and a narrow desktop window is still a desktop. */
export function usePhoneLayout(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
