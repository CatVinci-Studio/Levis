import { useEffect, useState } from "react";
import type { ShortcutAction, Shortcuts } from "../SettingsContext";
import type { Strings } from "../../i18n/strings";
import {
  comboFromEvent,
  isBindableCombo,
  formatCombo,
} from "../../utils/shortcuts";

// Generic row controls shared by the settings categories.

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="settings-row settings-toggle-row">
      <div>
        <div className="settings-row-label">{label}</div>
        <div className="settings-row-hint">{hint}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export function ShortcutRow({
  label,
  action,
  shortcuts,
  setSettings,
  t,
}: {
  label: string;
  action: ShortcutAction;
  shortcuts: Shortcuts;
  setSettings: (patch: { shortcuts: Shortcuts }) => void;
  t: Strings;
}) {
  const [recording, setRecording] = useState(false);
  const combo = shortcuts[action];

  useEffect(() => {
    if (!recording) return;
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const captured = comboFromEvent(e);
      if (!captured || !isBindableCombo(captured)) return;
      setSettings({ shortcuts: { ...shortcuts, [action]: captured } });
      setRecording(false);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, shortcuts, setSettings, action]);

  function clear() {
    setSettings({ shortcuts: { ...shortcuts, [action]: "" } });
  }

  return (
    <div className="settings-row">
      <span className="settings-row-label">{label}</span>
      <div className="shortcut-row-controls">
        <button
          className={`text-button settings-inline-button shortcut-capture-button ${recording ? "shortcut-capture-active" : ""}`}
          onClick={() => setRecording(true)}
        >
          {recording
            ? t.shortcutRecording
            : combo
              ? formatCombo(combo)
              : t.shortcutUnset}
        </button>
        {combo && !recording && (
          <button
            className="text-button settings-inline-button"
            onClick={clear}
          >
            {t.shortcutClear}
          </button>
        )}
      </div>
    </div>
  );
}
