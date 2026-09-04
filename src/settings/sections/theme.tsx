import { useId, useRef, useState } from "react";
import {
  useSettings,
  BUILTIN_CONTENT_THEMES,
  THEME_MODES,
  type UserThemeMeta,
} from "../SettingsContext";
import type { Strings } from "../../i18n/strings";
import { importThemeCss } from "../../utils/theme-import";
import { basename } from "../../utils/path";
import { fs, themes } from "../../ipc";
import { useLatest } from "../../utils/useLatest";

export function ThemeSection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const appearanceId = useId();
  const working = useRef(false);
  const latest = useLatest(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One step: pick a CSS file and it's imported and selected right away,
  // named after the file. (A dark variant can still exist in the data model
  // for themes that shipped one; imports are single-file.)
  async function importTheme() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      const picked = await fs.openCssFileDialog();
      if (!picked) return;
      const id = `user-${crypto.randomUUID()}`;
      const css = await importThemeCss(picked);
      await themes.saveThemeCss(id, "light", css);
      const meta: UserThemeMeta = {
        id,
        name: basename(picked).replace(/\.css$/i, ""),
        hasDark: false,
      };
      setSettings({
        userThemes: [...latest.current.userThemes, meta],
        themeId: id,
      });
    } catch (err) {
      setError(String(err));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function deleteCurrentTheme() {
    const current = settings.userThemes.find(
      (th) => th.id === settings.themeId,
    );
    if (!current) return;
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await themes.deleteTheme(current.id);
      setSettings({
        userThemes: latest.current.userThemes.filter(
          (th) => th.id !== current.id,
        ),
        ...(latest.current.themeId === current.id
          ? { themeId: "default" }
          : {}),
      });
    } catch (err) {
      setError(String(err));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  const isUserThemeSelected = settings.userThemes.some(
    (th) => th.id === settings.themeId,
  );

  return (
    <>
      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">{t.contentThemeLabel}</div>
          <div className="settings-row-hint">{t.contentThemeHint}</div>
        </div>
        <div className="shortcut-row-controls">
          <select
            className="settings-select"
            aria-label={t.contentThemeLabel}
            disabled={busy}
            value={settings.themeId}
            onChange={(e) => setSettings({ themeId: e.target.value })}
          >
            {BUILTIN_CONTENT_THEMES.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {t[theme.nameKey]}
              </option>
            ))}
            {settings.userThemes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </select>
          {isUserThemeSelected && (
            <button
              className="text-button settings-inline-button"
              disabled={busy}
              onClick={deleteCurrentTheme}
            >
              {t.themeDeleteButton}
            </button>
          )}
          <button
            className="text-button settings-inline-button"
            onClick={importTheme}
            disabled={busy}
          >
            {t.themeImportButton}
          </button>
        </div>
      </div>

      {/* Independent of the theme above: that picks the palette, this picks
          which of its two forms is shown. Every theme defines both. */}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">{t.appearanceLabel}</div>
          <div className="settings-row-hint">{t.appearanceHint}</div>
        </div>
        <div
          className="appearance-options"
          role="radiogroup"
          aria-label={t.appearanceLabel}
        >
          {THEME_MODES.map((mode) => (
            <label
              key={mode}
              className={`appearance-option${settings.theme === mode ? " is-selected" : ""}`}
            >
              <input
                type="radio"
                name={appearanceId}
                value={mode}
                checked={settings.theme === mode}
                onChange={() => setSettings({ theme: mode })}
              />
              {mode === "system"
                ? t.appearanceSystem
                : mode === "light"
                  ? t.appearanceLight
                  : t.appearanceDark}
            </label>
          ))}
        </div>
      </div>
    </>
  );
}
