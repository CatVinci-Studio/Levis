import type { AgentMode } from "../../settings/SettingsContext";

const KEY = "textus-agent-last-mode";

/**
 * The panel's mode carries over: a new conversation and the detached window
 * used to start back in the Settings default (Ask) right after the user had
 * switched to Edit. The pick is kept with the default it was made under, so
 * changing the default in Settings still takes effect. Shared through
 * localStorage, which the detached window sees too.
 */
export function initialMode(defaultMode: AgentMode): AgentMode {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultMode;
    const saved = JSON.parse(raw) as { mode?: unknown; under?: unknown };
    if (
      saved.under === defaultMode &&
      (saved.mode === "ask" || saved.mode === "edit" || saved.mode === "plan")
    )
      return saved.mode;
  } catch {
    // Unreadable or blocked storage: the default.
  }
  return defaultMode;
}

export function rememberMode(mode: AgentMode, defaultMode: AgentMode): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ mode, under: defaultMode }));
  } catch {
    // Not kept; the next conversation starts at the default.
  }
}
