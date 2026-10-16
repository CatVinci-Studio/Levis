import { useEffect, useRef } from "react";
import { opener } from "../ipc";
import type { Strings } from "../i18n/strings";
import { isIOSApp } from "../platform/capabilities";
import { showConfirm } from "../ui/app-dialog";

// Levis 0.9.8 is the last Levis: it tells its user, once, that the app
// lives on as Textus (a separate app - its own identifier, its own update
// feed) and where to get it. Settings > General keeps the link afterwards.
// Not on iOS: Levis was only ever a TestFlight build there, and Textus
// comes as a new App Store app.

export const TEXTUS_URL = "https://textus.catvinci.com";

export async function showTextusNotice(t: Strings): Promise<void> {
  const go = await showConfirm(t.textusNoticeText, {
    title: t.textusNoticeTitle,
    okLabel: t.textusNoticeOk,
    cancelLabel: t.textusNoticeLater,
  });
  if (go) await opener.openUrl(TEXTUS_URL).catch(() => {});
}

/** Shows the notice once, after the language welcome (on a fresh install)
 *  is out of the way. */
export function useTextusNotice(
  t: Strings,
  ready: boolean,
  shown: boolean,
  markShown: () => void,
) {
  const started = useRef(false);
  useEffect(() => {
    if (isIOSApp || shown || !ready || started.current) return;
    started.current = true;
    markShown();
    void showTextusNotice(t);
  }, [t, ready, shown, markShown]);
}
