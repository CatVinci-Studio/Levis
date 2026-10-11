/** Shared OS detection for shortcut dispatch, labels, and native features. */
export function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /mac/i.test(navigator.platform || navigator.userAgent)
  );
}

/** Windows. `navigator.platform` is "Win32" even on 64-bit Windows; the UA
 *  check is the fallback for runtimes that stopped reporting platform. */
export function isWindowsPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /^win/i.test(navigator.platform ?? "") ||
    /windows/i.test(navigator.userAgent)
  );
}

/** Linux desktop builds; Android also reports "Linux" and is excluded. */
export function isLinuxPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /linux/i.test(navigator.platform ?? "") &&
    !/android/i.test(navigator.userAgent)
  );
}
