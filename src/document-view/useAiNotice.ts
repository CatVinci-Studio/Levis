import { useCallback, useEffect, useRef, useState } from "react";

/** Transient, self-dismissing notice for on-demand AI triggers ("no issues
 *  found", "not signed in", ...) - deliberately not a native alert():
 *  those block the whole webview (and freeze automation) over messages
 *  that are often benign. */
export function useAiNotice() {
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  // When it goes, so a pointer resting on it can hold it (and give back
  // what was left of its time when it moves off).
  const noticeDeadline = useRef(0);
  const showAiNotice = useCallback((message: string | null) => {
    setAiNotice(message);
    window.clearTimeout(noticeTimer.current);
    if (!message) return;
    noticeDeadline.current = Date.now() + 4000;
    noticeTimer.current = window.setTimeout(() => setAiNotice(null), 4000);
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  const holdAiNotice = () => window.clearTimeout(noticeTimer.current);
  const releaseAiNotice = () => {
    const left = Math.max(1500, noticeDeadline.current - Date.now());
    noticeDeadline.current = Date.now() + left;
    noticeTimer.current = window.setTimeout(() => setAiNotice(null), left);
  };
  return { aiNotice, showAiNotice, holdAiNotice, releaseAiNotice };
}
