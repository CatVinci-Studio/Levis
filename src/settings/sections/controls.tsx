import { useEffect, useMemo, useState } from "react";
import type { ShortcutAction, Shortcuts } from "../SettingsContext";
import type { Strings } from "../../i18n/strings";
import {
  comboFromEvent,
  isBindableCombo,
  formatCombo,
  isReservedCombo,
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
  const [error, setError] = useState("");
  const actionLabels = useMemo<Record<ShortcutAction, string>>(
    () => ({
      triggerCompletion: t.shortcutTriggerCompletion,
      triggerGrammarCheck: t.shortcutTriggerGrammarCheck,
      toggleFloatingChat: t.shortcutToggleFloatingChat,
      findReplace: t.shortcutFindReplace,
      toggleSidebar: t.shortcutToggleSidebar,
      toggleSourceMode: t.shortcutToggleSourceMode,
      toggleTypewriterMode: t.shortcutToggleTypewriterMode,
    }),
    [t],
  );

  useEffect(() => {
    if (!recording) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const captured = comboFromEvent(e);
      if (!captured || !isBindableCombo(captured)) return;
      if (isReservedCombo(captured)) {
        setError(t.shortcutReserved);
        return;
      }
      const conflict = (Object.keys(shortcuts) as ShortcutAction[]).find(
        (other) => other !== action && shortcuts[other] === captured,
      );
      if (conflict) {
        setError(
          t.shortcutConflict.replace("{action}", actionLabels[conflict]),
        );
        return;
      }
      setError("");
      setSettings({ shortcuts: { ...shortcuts, [action]: captured } });
      setRecording(false);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, shortcuts, setSettings, action, actionLabels, t]);

  function clear() {
    setError("");
    setSettings({ shortcuts: { ...shortcuts, [action]: "" } });
  }

  return (
    <div className="shortcut-setting">
      <div className="settings-row">
        <span className="settings-row-label">{label}</span>
        <div className="shortcut-row-controls">
          <button
            className={`text-button settings-inline-button shortcut-capture-button ${recording ? "shortcut-capture-active" : ""}`}
            aria-label={`${label}: ${recording ? t.shortcutRecording : combo ? formatCombo(combo) : t.shortcutUnset}`}
            aria-pressed={recording}
            onClick={() => {
              setError("");
              setRecording(true);
            }}
            onBlur={() => setRecording(false)}
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
              aria-label={`${t.shortcutClear}: ${label}`}
              onClick={clear}
            >
              {t.shortcutClear}
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
