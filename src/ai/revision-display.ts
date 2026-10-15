import type { Strings } from "../i18n/strings";
import type { RevisionDisplay } from "../settings/SettingsContext";

/** A revision display's name, for the settings list and the review bar's
 *  menu. */
export function revisionDisplayName(t: Strings, mode: RevisionDisplay): string {
  return {
    inline: t.revisionDisplayInline,
    original: t.revisionDisplayOriginal,
    new: t.revisionDisplayNew,
    final: t.revisionDisplayFinal,
  }[mode];
}

/**
 * The display actually drawn: the margin views need a margin, and fall
 * back to everything in the text where there is none (a narrow window, a
 * phone).
 */
export function effectiveRevisionDisplay(
  mode: RevisionDisplay,
  hasMargin: boolean,
): RevisionDisplay {
  return !hasMargin && (mode === "original" || mode === "new")
    ? "inline"
    : mode;
}
