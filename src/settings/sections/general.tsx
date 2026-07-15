import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Strings } from "../../i18n/strings";

// The General category's sections beyond plain settings rows.

/**
 * Current version + a manual "Check for Updates" button. The background
 * check (useAppUpdate) is silent about being up to date and about errors;
 * a manual check is the opposite - the user asked, so "already latest" and
 * failures both get an explicit answer here.
 */
export function UpdateSection({ t }: { t: Strings }) {
  const [version, setVersion] = useState("");
  const [phase, setPhase] = useState<"idle" | "checking" | "latest" | "available" | "downloading" | "error">("idle");
  const [message, setMessage] = useState("");
  const [update, setUpdate] = useState<Update | null>(null);

  useEffect(() => {
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
        setMessage(`${t.updateAvailable} v${found.version}`);
      } else {
        setPhase("latest");
        setMessage(t.updateLatest);
      }
    } catch (err) {
      setPhase("error");
      setMessage(`${t.updateFailed} ${String(err)}`);
    }
  }

  async function install() {
    if (!update) return;
    setPhase("downloading");
    setMessage(t.updateDownloading);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (err) {
      setPhase("error");
      setMessage(`${t.updateFailed} ${String(err)}`);
    }
  }

  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">
          {t.updateVersionLabel} {version && `v${version}`}
        </div>
        {message && <div className={phase === "error" ? "settings-error" : "settings-row-hint"}>{message}</div>}
      </div>
      <div className="shortcut-row-controls">
        {phase === "available" || phase === "downloading" ? (
          <button className="text-button settings-inline-button" onClick={install} disabled={phase === "downloading"}>
            {t.updateInstall}
          </button>
        ) : (
          <button className="text-button settings-inline-button" onClick={checkNow} disabled={phase === "checking"}>
            {phase === "checking" ? t.updateChecking : t.updateCheckButton}
          </button>
        )}
      </div>
    </div>
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
    invoke<boolean>("cli_command_status").then(setInstalled);
  }, []);

  async function install() {
    setPhase("installing");
    setError(null);
    try {
      await invoke("install_cli_command");
      setInstalled(true);
      setPhase("idle");
    } catch (err) {
      setPhase("error");
      setError(String(err));
    }
  }

  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">{t.cliCommandLabel}</div>
        <div className="settings-row-hint">{t.cliCommandHint}</div>
        {error && <div className="settings-error">{t.cliCommandFailed} {error}</div>}
      </div>
      <div className="shortcut-row-controls">
        {!error && <span className="settings-row-hint">{installed ? t.cliCommandInstalled : t.cliCommandNotInstalled}</span>}
        <button className="text-button settings-inline-button" onClick={install} disabled={phase === "installing"}>
          {phase === "installing"
            ? t.cliCommandInstalling
            : installed
              ? t.cliCommandReinstallButton
              : t.cliCommandInstallButton}
        </button>
      </div>
    </div>
  );
}
