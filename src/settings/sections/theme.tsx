import { useState } from "react";
import {
  useSettings,
  BUILTIN_CONTENT_THEMES,
  type UserThemeMeta,
} from "../SettingsContext";
import type { Strings } from "../../i18n/strings";
import { importThemeCss } from "../../utils/theme-import";
import { basename } from "../../utils/path";
import { fs, themes } from "../../ipc";

export function ThemeSection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One step: pick a CSS file and it's imported and selected right away,
  // named after the file. (A dark variant can still exist in the data model
  // for themes that shipped one; imports are single-file.)
  async function importTheme() {
    const picked = await fs.openCssFileDialog();
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const id = `user-${Date.now()}`;
      const css = await importThemeCss(picked);
      await themes.saveThemeCss(id, "light", css);
      const meta: UserThemeMeta = {
        id,
        name: basename(picked).replace(/\.css$/i, ""),
        hasDark: false,
      };
      setSettings({ userThemes: [...settings.userThemes, meta], themeId: id });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteCurrentTheme() {
    const current = settings.userThemes.find(
      (th) => th.id === settings.themeId,
    );
    if (!current) return;
    await themes.deleteTheme(current.id);
    setSettings({
      userThemes: settings.userThemes.filter((th) => th.id !== current.id),
      themeId: "default",
    });
  }

  const isUserThemeSelected = settings.userThemes.some(
    (th) => th.id === settings.themeId,
  );

  return (
    <>
      {error && <div className="settings-error">{error}</div>}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">{t.contentThemeLabel}</div>
          <div className="settings-row-hint">{t.contentThemeHint}</div>
        </div>
        <div className="shortcut-row-controls">
          <select
            className="settings-select"
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
    </>
  );
}
