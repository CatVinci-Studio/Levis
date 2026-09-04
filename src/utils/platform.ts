/** Shared OS detection for shortcut dispatch, labels, and native features. */
export function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /mac/i.test(navigator.platform || navigator.userAgent)
  );
}
