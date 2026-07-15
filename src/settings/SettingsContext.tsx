import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { strings, type Lang, type Strings } from "../i18n/strings";

export type ThemeMode = "system" | "light" | "dark";
export type AiProvider = "codex" | "claude" | "apikey" | "custom";
export type NewDocumentMode = "window" | "tab";
export type ProxyType = "none" | "http" | "https" | "socks5";

/// Keyboard-triggerable actions. Each maps to a normalized combo string
/// (see ../utils/shortcuts) - empty string means "unbound".
export type ShortcutAction =
  | "triggerCompletion"
  | "triggerGrammarCheck"
  | "toggleFloatingChat"
  | "toggleSidebar"
  | "toggleSourceMode"
  | "toggleTypewriterMode"
  | "findReplace";

export type Shortcuts = Record<ShortcutAction, string>;

const DEFAULT_SHORTCUTS: Shortcuts = {
  triggerCompletion: "mod+shift+space",
  triggerGrammarCheck: "mod+shift+g",
  toggleFloatingChat: "mod+shift+k",
  toggleSidebar: "mod+\\",
  toggleSourceMode: "mod+/",
  toggleTypewriterMode: "",
  findReplace: "mod+f",
};

/// Built-in content themes only override `--editor-*` CSS variables (see
/// content-themes.css) - "default" means none of them are active, so the
/// base variables from App.css apply as-is.
export type BuiltinContentThemeId = "default" | "paper" | "slate" | "forest";

export const BUILTIN_CONTENT_THEMES: { id: BuiltinContentThemeId; name: string }[] = [
  { id: "default", name: "Default" },
  { id: "paper", name: "Paper" },
  { id: "slate", name: "Slate" },
  { id: "forest", name: "Forest" },
];

/// Tone presets for AI completion - resolved to an English style directive
/// appended to the completion prompt (see ../ai/completion-style).
export type CompletionTone = "default" | "formal" | "casual" | "academic" | "concise";

export const COMPLETION_TONES: CompletionTone[] = ["default", "formal", "casual", "academic", "concise"];

export type GrammarStrictness = "typos" | "standard" | "strict";

export const GRAMMAR_STRICTNESS_LEVELS: GrammarStrictness[] = ["typos", "standard", "strict"];

/// A user-imported (Typora-style) theme. The actual CSS lives on disk under
/// the app's theme directory (see ../utils/theme-import and the Rust
/// save_theme_css/load_theme_css commands) - only small metadata is kept
/// here in localStorage.
export interface UserThemeMeta {
  id: string;
  name: string;
  hasDark: boolean;
}

export interface Settings {
  language: Lang;
  theme: ThemeMode;
  enableCompletion: boolean;
  enableGrammarCheck: boolean;
  /// How aggressive the grammar check is - from confident typos only up to
  /// style and clarity nits. Sent with every ai_grammar_check request.
  grammarStrictness: GrammarStrictness;
  enableAskAi: boolean;
  enableMath: boolean;
  enableMermaid: boolean;
  aiProvider: AiProvider;
  /// Agent chat model per provider; "" uses the provider's default.
  codexAgentModel: string;
  claudeAgentModel: string;
  apikeyAgentModel: string;
  /// Tone preset for inline completion suggestions.
  completionTone: CompletionTone;
  /// Offer OpenAI's server-side web search to the chat agent (codex only).
  enableWebSearch: boolean;
  /// Proxy all AI provider requests route through, as type + host + port
  /// ("none" or an empty host means direct connection). Mirrored to Rust as
  /// a URL (see the effect below) because requests are sent from Rust, which
  /// can't read localStorage.
  proxyType: ProxyType;
  proxyHost: string;
  proxyPort: string;
  typewriterMode: boolean;
  shortcuts: Shortcuts;
  /// Either a `BuiltinContentThemeId` or a `UserThemeMeta.id`.
  themeId: string;
  userThemes: UserThemeMeta[];
  /// "window" (default): opening another document spawns a new OS window,
  /// unchanged from the original behavior. "tab": opening another document
  /// opens a tab in the current window instead. Mirrored to Rust (see the
  /// effect below) because window-vs-tab has to be decided in Rust, before
  /// any webview - let alone its localStorage - exists.
  newDocumentMode: NewDocumentMode;
  /// Whether startup reopens last session's documents (default) or starts
  /// blank. Mirrored to Rust (see the effect below) because the decision is
  /// made in setup(), before any webview - let alone its localStorage -
  /// exists; this is also what lets an app-update relaunch (which starts
  /// with no file arguments at all) reopen whatever was open before it.
  restoreSessionOnStartup: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  language: "en",
  theme: "system",
  enableCompletion: true,
  enableGrammarCheck: true,
  grammarStrictness: "standard",
  enableAskAi: true,
  enableMath: true,
  enableMermaid: true,
  aiProvider: "codex",
  codexAgentModel: "",
  claudeAgentModel: "",
  apikeyAgentModel: "",
  completionTone: "default",
  enableWebSearch: false,
  proxyType: "none",
  proxyHost: "",
  proxyPort: "",
  typewriterMode: false,
  shortcuts: DEFAULT_SHORTCUTS,
  themeId: "default",
  userThemes: [],
  newDocumentMode: "window",
  restoreSessionOnStartup: true,
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
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...(parsed.shortcuts ?? {}) },
      // The light/dark picker was removed from Settings - appearance always
      // follows the system now, including for users who had picked one back
      // when the control existed.
      theme: "system",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function isEffectiveDark(themeMode: ThemeMode): boolean {
  if (themeMode === "dark") return true;
  if (themeMode === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(loadSettings);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    void invoke("set_new_document_mode", { mode: settings.newDocumentMode });
  }, [settings.newDocumentMode]);

  useEffect(() => {
    void invoke("set_restore_session_on_startup", { enabled: settings.restoreSessionOnStartup });
  }, [settings.restoreSessionOnStartup]);

  // An unparseable proxy is rejected by the backend (and requests fall back
  // to a direct connection), so a half-typed host while editing the setting
  // can't wedge anything.
  useEffect(() => {
    const host = settings.proxyHost.trim();
    const port = settings.proxyPort.trim();
    const proxy =
      settings.proxyType !== "none" && host ? `${settings.proxyType}://${host}${port ? `:${port}` : ""}` : null;
    invoke("set_ai_proxy", { proxy }).catch(() => {});
  }, [settings.proxyType, settings.proxyHost, settings.proxyPort]);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", settings.theme);
    }
  }, [settings.theme]);

  // Resolves the selected theme (built-in content theme, user-imported
  // theme, or "default") to either a `data-content-theme` attribute (for
  // built-ins, which are pure CSS-variable overlays - see
  // content-themes.css) or an injected <style> tag with the theme's raw CSS
  // (for user themes, which are arbitrary Typora-style stylesheets read from
  // disk). Re-resolves on theme/mode change and on live OS dark/light
  // switches while in "system" mode.
  useEffect(() => {
    const root = document.documentElement;
    const STYLE_ID = "levis-custom-theme";

    function clearInjectedStyle() {
      document.getElementById(STYLE_ID)?.remove();
    }

    const builtin = BUILTIN_CONTENT_THEMES.find((t) => t.id === settings.themeId);
    if (builtin) {
      if (builtin.id === "default") root.removeAttribute("data-content-theme");
      else root.setAttribute("data-content-theme", builtin.id);
      clearInjectedStyle();
      return;
    }

    const userTheme = settings.userThemes.find((t) => t.id === settings.themeId);
    if (!userTheme) {
      // Unknown or deleted theme (e.g. loaded from a stale settings blob) -
      // fall back to default rather than silently doing nothing.
      root.removeAttribute("data-content-theme");
      clearInjectedStyle();
      if (settings.themeId !== "default") setSettings({ themeId: "default" });
      return;
    }

    root.removeAttribute("data-content-theme");
    let cancelled = false;
    const theme = userTheme;

    async function applyUserTheme() {
      const variant = isEffectiveDark(settings.theme) && theme.hasDark ? "dark" : "light";
      try {
        const css = await invoke<string | null>("load_theme_css", { id: theme.id, variant });
        if (cancelled) return;
        let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
        if (!styleEl) {
          styleEl = document.createElement("style");
          styleEl.id = STYLE_ID;
        }
        styleEl.textContent = css ?? "";
        document.head.appendChild(styleEl);
      } catch {
        // Theme file missing/unreadable - leave whatever was there before.
      }
    }

    void applyUserTheme();

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", applyUserTheme);
    return () => {
      cancelled = true;
      mq.removeEventListener("change", applyUserTheme);
    };
  }, [settings.themeId, settings.theme, settings.userThemes]);

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
