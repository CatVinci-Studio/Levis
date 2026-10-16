import { isIOSApp } from "../platform/capabilities";
import { Presence, PresenceDiv } from "../ui/usePresence";
import type { Strings } from "../i18n/strings";
import type { useAppUpdate } from "./useAppUpdate";

/** Zen mode's way out, shown while it is on (useZenMode.ts). */
export function ZenHint({ onExit, t }: { onExit: () => void; t: Strings }) {
  return isIOSApp ? (
    // No Esc key on a phone, and zen hides the menu: the hint is
    // the way out, so it stays (faintly) and takes a tap.
    <button type="button" className="zen-hint zen-hint-button" onClick={onExit}>
      {t.zenExitButton}
    </button>
  ) : (
    <div className="zen-hint" role="status">
      {t.zenExitHint}
    </div>
  );
}

/** Says that drafts from an earlier session were brought back
 *  (useStartupRestore). */
export function DraftRestoredToast({
  count,
  onDismiss,
  t,
}: {
  count: number;
  onDismiss: () => void;
  t: Strings;
}) {
  return (
    <Presence show={count > 0} exitMs={120}>
      {count > 0 && (
        <PresenceDiv className="draft-restored-toast">
          <span>{t.draftRestoredMessage}</span>
          <button className="update-toast-secondary" onClick={onDismiss}>
            {t.draftRestoredDismiss}
          </button>
        </PresenceDiv>
      )}
    </Presence>
  );
}

/** The update banner (useAppUpdate.ts): available, downloading, failed. */
export function UpdateToast({
  appUpdate,
  t,
}: {
  appUpdate: ReturnType<typeof useAppUpdate>;
  t: Strings;
}) {
  return (
    <Presence show={appUpdate.status !== "idle"} exitMs={120}>
      {appUpdate.status !== "idle" && (
        <PresenceDiv className="update-toast">
          {appUpdate.status === "available" && (
            <>
              <span>
                {t.updateAvailable} v{appUpdate.version}
              </span>
              {appUpdate.selfUpdate ? (
                <button
                  className="update-toast-primary"
                  onClick={() => void appUpdate.install()}
                >
                  {t.updateInstall}
                </button>
              ) : (
                <span>{t.updateViaPackageManager}</span>
              )}
              <button
                className="update-toast-secondary"
                onClick={appUpdate.dismiss}
              >
                {t.updateLater}
              </button>
            </>
          )}
          {appUpdate.status === "downloading" && (
            <span>{t.updateDownloading}</span>
          )}
          {appUpdate.status === "error" && (
            <>
              <span>
                {t.updateFailed} {appUpdate.error}
              </span>
              <button
                className="update-toast-secondary"
                onClick={appUpdate.dismiss}
              >
                {t.updateLater}
              </button>
            </>
          )}
        </PresenceDiv>
      )}
    </Presence>
  );
}
