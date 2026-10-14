import { errorText } from "../../utils/error-text";
import { useId, useRef, useState } from "react";
import {
  useSettings,
  BUILTIN_CONTENT_THEMES,
  THEME_MODES,
  type UserThemeMeta,
} from "../SettingsContext";
import type { Strings } from "../../i18n/strings";
import { importThemeCss } from "../../utils/theme-import";
import { ornamentRules } from "../../utils/theme-export";
import { basename } from "../../utils/path";
import { showMessage } from "../../ui/app-dialog";
import { exportDoc, fs, themes } from "../../ipc";
import { useLatest } from "../../utils/useLatest";
import { Select } from "../../ui/Select";
import { SettingRow } from "./controls";

const CUSTOM_CSS_PLACEHOLDER = `#write p {
  text-indent: 2em;
  line-height: 2;
}`;

/** The variables a theme sets (see the levis-theme skill), as the current
 *  theme resolves them - the starting point of an exported theme. */
const THEME_VARIABLES = [
  "--editor-bg",
  "--editor-text",
  "--editor-muted",
  "--editor-accent",
  "--editor-border",
  "--editor-code-bg",
  "--editor-quote-border",
  "--editor-highlight-bg",
  "--editor-font",
  "--editor-list-gap",
];

/**
 * Writes the current theme out as a starter CSS file (#13): the colour and
 * font variables as they resolve right now, Levis's heading/quote/table
 * ornaments (#29), the user's own CSS, and a few commented hooks for the
 * usual adjustments. Importing the edited file
 * (Import Theme) makes it a theme of its own.
 */
async function exportThemeCss(t: Strings, customCss: string): Promise<void> {
  const style = getComputedStyle(document.documentElement);
  const write = document.querySelector("#write");
  const writeStyle = write ? getComputedStyle(write) : null;
  const variables = THEME_VARIABLES.map((name) => {
    const value =
      style.getPropertyValue(name).trim() ||
      writeStyle?.getPropertyValue(name).trim();
    return value ? `  ${name}: ${value};` : `  /* ${name}: ; */`;
  }).join("\n");
  const css = `/* Levis theme - exported from Settings > Theme.
   Edit it, then bring it back with Import Theme.
   #write is the document; .milkdown wraps it. */

:root {
${variables}
}

/* Body text */
#write {
  /* font-size: 17px; */
  /* line-height: 1.8; */
  /* max-width: 860px; */
}

#write p {
  /* text-indent: 2em; */
}

#write h1,
#write h2,
#write h3 {
  /* font-family: "Songti SC", serif; */
}

/* Levis's ornaments - delete any you don't want */
${ornamentRules()}
${customCss.trim() ? `\n/* Custom CSS */\n${customCss}\n` : ""}`;
  const picked = await exportDoc.exportSaveDialog(
    "levis-theme.css",
    "CSS",
    "css",
  );
  if (!picked) return;
  try {
    await fs.writeTextFile(picked, css);
    void exportDoc.revealInDir(picked);
  } catch (err) {
    await showMessage(`${t.exportFailed} ${errorText(err)}`, { tone: "error" });
  }
}

export function ThemeSection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const appearanceId = useId();
  const working = useRef(false);
  const latest = useLatest(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Open when there is CSS to show, judged once: following the text would
  // fold the box (and take the focus out of it) the moment it is emptied.
  const [customCssOpen, setCustomCssOpen] = useState(
    () => !!settings.customCss?.trim(),
  );

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
      setError(errorText(err));
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
      setError(errorText(err));
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
      {/* Independent of the theme below: that picks the palette, this picks
          which of its two forms is shown. Every theme defines both. */}
      <SettingRow label={t.appearanceLabel}>
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
      </SettingRow>

      <SettingRow label={t.contentThemeLabel}>
        <Select
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
        </Select>
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
      </SettingRow>

      {/* A tweak on top of the theme, folded away until wanted. */}
      <details
        className="settings-disclosure"
        open={customCssOpen}
        onToggle={(e) => setCustomCssOpen(e.currentTarget.open)}
      >
        <summary className="settings-disclosure-summary">
          {t.customCssLabel}
        </summary>
        <div className="settings-disclosure-body">
          <div className="settings-row-hint">{t.customCssHint}</div>
          <textarea
            className="settings-code-input"
            aria-label={t.customCssLabel}
            spellCheck={false}
            rows={5}
            placeholder={CUSTOM_CSS_PLACEHOLDER}
            value={settings.customCss}
            onChange={(e) => setSettings({ customCss: e.target.value })}
          />
          <div className="shortcut-row-controls">
            <button
              className="text-button settings-inline-button"
              onClick={() => void exportThemeCss(t, settings.customCss)}
            >
              {t.themeExportButton}
            </button>
          </div>
        </div>
      </details>
    </>
  );
}
