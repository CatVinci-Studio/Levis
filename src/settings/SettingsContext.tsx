import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { strings, type Lang, type Strings } from "../i18n/strings";

export type ThemeMode = "system" | "light" | "dark";
export type AiProvider = "codex" | "claude" | "apikey" | "custom";

export interface Settings {
  language: Lang;
  theme: ThemeMode;
  enableCompletion: boolean;
  enableGrammarCheck: boolean;
  aiProvider: AiProvider;
  typewriterMode: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  language: "en",
  theme: "system",
  enableCompletion: true,
  enableGrammarCheck: true,
  aiProvider: "codex",
  typewriterMode: false,
};

const STORAGE_KEY = "catvinci-settings";

interface SettingsContextValue {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  t: Strings;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(loadSettings);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", settings.theme);
    }
  }, [settings.theme]);

  function setSettings(patch: Partial<Settings>) {
    setSettingsState((prev) => ({ ...prev, ...patch }));
  }

  const t = strings[settings.language];

  const value = useMemo(() => ({ settings, setSettings, t }), [settings, t]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
