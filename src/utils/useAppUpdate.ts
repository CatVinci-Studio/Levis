import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus = "idle" | "available" | "downloading" | "error";

/**
 * Checks GitHub Releases once at startup (the updater endpoint points at the
 * latest release's latest.json) and drives the update banner: available ->
 * user confirms -> download + install -> relaunch. Checking is silent on
 * failure - offline, rate-limited, or running in a plain browser during
 * development are all normal situations, not something to bother the user
 * about. Installing is the opposite: the user explicitly asked, so errors
 * surface.
 */
export function useAppUpdate() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const checkOnce = () => {
      check()
        .then((found) => {
          if (!cancelled && found) {
            setUpdate(found);
            setStatus("available");
          }
        })
        .catch(() => {
          // Silent by design - see the hook comment.
        });
    };

    // Once at startup, then periodically so a window that stays open for
    // days still hears about new releases.
    checkOnce();
    const timer = setInterval(checkOnce, 4 * 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function install() {
    if (!update) return;
    setStatus("downloading");
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  }

  function dismiss() {
    setUpdate(null);
    setStatus("idle");
  }

  return { version: update?.version ?? null, status, error, install, dismiss };
}
