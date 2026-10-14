import { errorText } from "../../utils/error-text";
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Strings } from "../../i18n/strings";
import { cli } from "../../ipc";
import { flushPendingWrites } from "../../storage/pending-writes";
import { selfUpdateAllowed } from "../../utils/distribution";
import { canAutoUpdate } from "../../platform/capabilities";
import { SettingRow } from "./controls";

// The General category's sections beyond plain settings rows.

/**
 * Current version + a manual "Check for Updates" button. The background
 * check (useAppUpdate) is silent about being up to date and about errors;
 * a manual check is the opposite - the user asked, so "already latest" and
 * failures both get an explicit answer here. A package-manager build only
 * reports the new version - see utils/distribution.ts.
 */
export function UpdateSection({ t }: { t: Strings }) {
  const [version, setVersion] = useState("");
  const [phase, setPhase] = useState<
    "idle" | "checking" | "latest" | "available" | "downloading" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [update, setUpdate] = useState<Update | null>(null);
  const [selfUpdate, setSelfUpdate] = useState(true);

  useEffect(() => {
    if (canAutoUpdate) void selfUpdateAllowed().then(setSelfUpdate);
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  async function checkNow() {
    setPhase("checking");
    setMessage("");
    try {
      const found = await check();
      if (found) {
        setUpdate(found);
        setPhase("available");
        setMessage(
          selfUpdate
            ? `${t.updateAvailable} v${found.version}`
            : `${t.updateAvailable} v${found.version} ${t.updateViaPackageManager}`,
        );
      } else {
        setPhase("latest");
        setMessage(t.updateLatest);
      }
    } catch (err) {
      setPhase("error");
      setMessage(`${t.updateFailed} ${errorText(err)}`);
    }
  }

  async function install() {
    if (!update || !selfUpdate) return;
    setPhase("downloading");
    setMessage(t.updateDownloading);
    try {
      // Neither way out of here asks a window to close first. On Windows
      // downloadAndInstall never returns: it starts the installer and ends
      // the process (tauri-plugin-updater calls std::process::exit, which
      // also skips Rust's exit-time flush) - so what's held back goes now,
      // and Rust's own 250 ms write lands while the download runs.
      await flushPendingWrites();
      await update.downloadAndInstall();
      // macOS and Linux: anything changed during the download, then the
      // relaunch (which does flush Rust's files on its way out).
      await flushPendingWrites();
      await relaunch();
    } catch (err) {
      setPhase("error");
      setMessage(`${t.updateFailed} ${errorText(err)}`);
    }
  }

  return (
    <SettingRow
      label={
        version ? `${t.updateVersionLabel} v${version}` : t.updateVersionLabel
      }
      hint={phase === "error" ? undefined : message || undefined}
      error={phase === "error" ? message : null}
    >
      {/* No updater on iOS (App Store updates): the version alone. */}
      {canAutoUpdate &&
        (selfUpdate && (phase === "available" || phase === "downloading") ? (
          <button
            className="text-button settings-inline-button"
            onClick={install}
            disabled={phase === "downloading"}
          >
            {t.updateInstall}
          </button>
        ) : (
          <button
            className="text-button settings-inline-button"
            onClick={checkNow}
            disabled={phase === "checking"}
          >
            {phase === "checking" ? t.updateChecking : t.updateCheckButton}
          </button>
        ))}
    </SettingRow>
  );
}

/**
 * Startup already tries a silent, non-privileged install (works when
 * /usr/local/bin happens to be user-writable, e.g. via Homebrew). This row
 * is for the common case where that silently failed: it shows current
 * status and, on click, retries through an admin-privileged prompt.
 */
export function CliCommandSection({ t }: { t: Strings }) {
  const [installed, setInstalled] = useState(false);
  const [phase, setPhase] = useState<"idle" | "installing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cli.cliCommandStatus().then(setInstalled);
  }, []);

  async function install() {
    setPhase("installing");
    setError(null);
    try {
      await cli.installCliCommand();
      setInstalled(true);
      setPhase("idle");
    } catch (err) {
      setPhase("error");
      setError(errorText(err));
    }
  }

  return (
    <SettingRow
      label={t.cliCommandLabel}
      hint={t.cliCommandHint}
      error={error && `${t.cliCommandFailed} ${error}`}
    >
      {!error && (
        <span className="settings-row-value">
          {installed ? t.cliCommandInstalled : t.cliCommandNotInstalled}
        </span>
      )}
      <button
        className="text-button settings-inline-button"
        onClick={install}
        disabled={phase === "installing"}
      >
        {phase === "installing"
          ? t.cliCommandInstalling
          : installed
            ? t.cliCommandReinstallButton
            : t.cliCommandInstallButton}
      </button>
    </SettingRow>
  );
}
