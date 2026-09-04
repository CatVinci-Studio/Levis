import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  strings,
  type Lang,
  type Strings,
  type StringKey,
} from "../i18n/strings";
import { ai, prefs, themes } from "../ipc";
import { applyThemeChrome, clearThemeChrome } from "../utils/theme-chrome";

/// Light/dark, orthogonal to which content theme is selected: `themeId`
/// picks the palette, this picks which of its two forms is shown. Every
/// theme defines BOTH (see content-themes.css) - one that only has a single
/// design defines the same values twice - so the two axes compose without
/// any combination being undefined.
export type ThemeMode = "system" | "light" | "dark";
/// A provider catalog id (src-tauri/src/ai/catalog.rs) - "openai",
/// "anthropic", "google", "custom", etc. Not a closed union: the catalog is
/// the source of truth for which providers exist, fetched at runtime.
export type AiProvider = string;
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

export const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

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
export type BuiltinContentThemeId =
  "default" | "paper" | "slate" | "forest" | "parchment";

/// `nameKey` points at an i18n string so the picker label follows the app
/// language (see settings/sections/theme.tsx); `name` stays as a stable
/// English fallback. User-imported themes keep their filename, untranslated.
///
/// Every one of these defines a light AND a dark palette in
/// content-themes.css; `ThemeMode` chooses between them. A theme with only
/// one design still defines both, with identical values, so that switching
/// appearance leaves it alone instead of half-applying.
export const BUILTIN_CONTENT_THEMES: {
  id: BuiltinContentThemeId;
  name: string;
  nameKey: StringKey;
}[] = [
  { id: "default", name: "Default", nameKey: "themeNameDefault" },
  { id: "paper", name: "Paper", nameKey: "themeNamePaper" },
  { id: "slate", name: "Slate", nameKey: "themeNameSlate" },
  { id: "forest", name: "Forest", nameKey: "themeNameForest" },
  { id: "parchment", name: "Parchment", nameKey: "themeNameParchment" },
];

/// Tone presets for AI completion - resolved to an English style directive
/// appended to the completion prompt (see ../ai/completion-style).
export type CompletionTone =
  "default" | "formal" | "casual" | "academic" | "concise";

export const COMPLETION_TONES: CompletionTone[] = [
  "default",
  "formal",
  "casual",
  "academic",
  "concise",
];

export type GrammarStrictness = "typos" | "standard" | "strict";

export const GRAMMAR_STRICTNESS_LEVELS: GrammarStrictness[] = [
  "typos",
  "standard",
  "strict",
];

/// A user-imported (Typora-style) theme. The actual CSS lives on disk under
/// the app's theme directory (see ../utils/theme-import and the Rust
/// save_theme_css/load_theme_css commands) - only small metadata is kept
/// here in localStorage.
export interface UserThemeMeta {
  id: string;
  name: string;
  hasDark: boolean;
}

export type ImageStorageMode = "local" | "image-host";
export type ImageNamingMode = "auto" | "original" | "ask";
export type AgentMode = "ask" | "edit" | "plan";

export interface Settings {
  language: Lang;
  /** False only on a fresh install, until the language welcome screen is
   *  confirmed. Existing installations are migrated to true. */
  languageChosen: boolean;
  /// Appearance: follow the OS, or pin light/dark. Independent of `themeId`.
  theme: ThemeMode;
  enableCompletion: boolean;
  enableGrammarCheck: boolean;
  /// How aggressive the grammar check is - from confident typos only up to
  /// style and clarity nits. Sent with every ai_grammar_check request.
  grammarStrictness: GrammarStrictness;
  enableAskAi: boolean;
  enableMath: boolean;
  enableMermaid: boolean;
  /** Where newly pasted images go. Existing markdown image references are
   *  never migrated when this changes. */
  imageStorageMode: ImageStorageMode;
  /** Filename policy used only by the remote image-host uploader. */
  imageNamingMode: ImageNamingMode;
  /** A user-owned multipart endpoint. It receives the image in `file`. */
  imageUploadEndpoint: string;
  /** Dot-separated path to the public URL in the endpoint's JSON response. */
  imageUploadUrlField: string;
  aiProvider: AiProvider;
  /// Shared model for inline completion and grammar checking, per provider.
  /// Missing/"" keeps the provider's low-cost writing default.
  writingModels: Record<string, string>;
  /// Agent chat model per provider id; missing/"" uses the provider's
  /// default. Keyed by catalog id, so adding a provider needs no Settings
  /// shape change.
  agentModels: Record<string, string>;
  /** Initial mode shown in a newly mounted Agent composer. */
  agentDefaultMode: AgentMode;
  /// Tone preset for inline completion suggestions.
  completionTone: CompletionTone;
  /// Offer the active provider's native server-side web search to Agent;
  /// providers without a compatible search API safely ignore it.
  enableWebSearch: boolean;
  /// Whether an agent edit's green in-document preview streams/types itself
  /// in (pending-edit-plugin's typewriter) or appears complete at once.
  enableEditAnimation: boolean;
  /// How far the detached Agent window is shared. Off (default): one chat
  /// window per editor window, shared by that window's tabs. On: a single
  /// chat window for the whole app, following whichever document is active
  /// in whichever window. Either way there is never more than one per
  /// scope - the detached window IS the cross-file surface, so popping the
  /// chat out of a second file reveals it rather than spawning a rival
  /// (see commands/chat_window.rs).
  shareAgentWindowAcrossWindows: boolean;
  /// Whether the detached Agent window floats above other windows. Kept
  /// here rather than per-window so the choice survives closing it.
  pinAgentWindow: boolean;
  /// Explicit agent workspace root, or "" for the default (the folder of
  /// the document being edited). This is the folder `.levis/agent.md` and
  /// `.levis/skills/` are read from AND the sandbox boundary of the agent's
  /// list_files/read_file tools, so setting it is what lets the agent reach
  /// reference material that doesn't live next to the draft.
  agentWorkspaceRoot: string;
  /// Proxy all AI provider requests route through, as type + host + port
  /// ("none" or an empty host means direct connection). Mirrored to Rust as
  /// a URL (see the effect below) because requests are sent from Rust, which
  /// can't read localStorage.
  proxyType: ProxyType;
  proxyHost: string;
  proxyPort: string;
  typewriterMode: boolean;
  /// Whole-page zoom factor (1 = 100%), driven by pinch / mod+wheel / the
  /// View menu (see ../utils/useZoom). Saved here so it survives restarts;
  /// each window applies it independently on mount.
  zoom: number;
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
  /** Suggest an H1 or first content line as a draft's Save As filename. */
  autoSuggestFilename: boolean;
  /// Set once the first-run tutorial has been shown (or skipped) - belt and
  /// suspenders alongside `isFreshInstall` below, in case a window closes
  /// mid-tutorial before the user reaches the end.
  onboardingShown: boolean;
  /// Privacy toggles (Settings > Privacy) - each independently disables one
  /// kind of locally-stored history/recovery data going forward. Turning
  /// one off does not retroactively clear what's already stored; the
  /// section's own "Clear" button does that explicitly.
  enableChatHistory: boolean;
  enableClipboardHistory: boolean;
  enableDraftRecovery: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  language: "en",
  languageChosen: false,
  theme: "system",
  enableCompletion: true,
  enableGrammarCheck: true,
  grammarStrictness: "standard",
  enableAskAi: true,
  enableMath: true,
  enableMermaid: true,
  imageStorageMode: "local",
  imageNamingMode: "auto",
  imageUploadEndpoint: "",
  imageUploadUrlField: "url",
  aiProvider: "openai",
  writingModels: {},
  agentModels: {},
  agentDefaultMode: "ask",
  completionTone: "default",
  enableWebSearch: false,
  enableEditAnimation: true,
  shareAgentWindowAcrossWindows: false,
  pinAgentWindow: false,
  agentWorkspaceRoot: "",
  proxyType: "none",
  proxyHost: "",
  proxyPort: "",
  typewriterMode: false,
  zoom: 1,
  shortcuts: DEFAULT_SHORTCUTS,
  themeId: "default",
  userThemes: [],
  newDocumentMode: "window",
  restoreSessionOnStartup: true,
  autoSuggestFilename: true,
  onboardingShown: false,
  enableChatHistory: true,
  enableClipboardHistory: true,
  enableDraftRecovery: true,
};

const STORAGE_KEY = "catvinci-settings";

interface SettingsContextValue {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  t: Strings;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/// Maps a pre-catalog-expansion provider id to its new catalog id - "codex"
/// and "apikey" both become "openai" (now one entry with two auth methods).
const LEGACY_PROVIDER_IDS: Record<string, string> = {
  codex: "openai",
  claude: "anthropic",
  apikey: "openai",
};

/// Old settings blobs kept one model field per provider id
/// (`${provider}AgentModel`); folds those into the new `agentModels` map,
/// translating ids through `LEGACY_PROVIDER_IDS`.
function migrateAgentModels(
  parsed: Record<string, unknown>,
): Record<string, string> {
  const models: Record<string, string> = {
    ...(parsed.agentModels as Record<string, string> | undefined),
  };
  for (const legacyId of ["codex", "claude", "apikey"]) {
    const value = parsed[`${legacyId}AgentModel`];
    if (typeof value === "string" && value)
      models[LEGACY_PROVIDER_IDS[legacyId]] = value;
  }
  return models;
}

/** Exported so small standalone stores (chat-history.ts, clipboard-history.ts)
 *  can read a privacy toggle's current value without depending on React
 *  context - they're plain localStorage-backed modules, not components. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const locale =
        typeof navigator === "undefined"
          ? ""
          : navigator.language.toLowerCase();
      const language: Lang = locale.startsWith("zh")
        ? "zh"
        : locale.startsWith("ja")
          ? "ja"
          : "en";
      return { ...DEFAULT_SETTINGS, language };
    }
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      // Existing installations created before the newcomer guide had no
      // field at all and must not suddenly receive first-run onboarding
      // after an update. A genuinely new install starts from DEFAULT_SETTINGS
      // (false); once shown, the explicit true value persists normally.
      onboardingShown:
        typeof parsed.onboardingShown === "boolean"
          ? parsed.onboardingShown
          : true,
      languageChosen:
        typeof parsed.languageChosen === "boolean"
          ? parsed.languageChosen
          : true,
      aiProvider:
        LEGACY_PROVIDER_IDS[parsed.aiProvider] ??
        parsed.aiProvider ??
        DEFAULT_SETTINGS.aiProvider,
      agentModels: migrateAgentModels(parsed),
      writingModels: {
        ...(parsed.writingModels as Record<string, string> | undefined),
      },
      agentDefaultMode: ["ask", "edit", "plan"].includes(
        parsed.agentDefaultMode,
      )
        ? (parsed.agentDefaultMode as AgentMode)
        : DEFAULT_SETTINGS.agentDefaultMode,
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...(parsed.shortcuts ?? {}) },
      theme: THEME_MODES.includes(parsed.theme)
        ? (parsed.theme as ThemeMode)
        : DEFAULT_SETTINGS.theme,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/// Optional-called: an environment without matchMedia (jsdom, an odd
/// webview) must not throw here - `isEffectiveDark` is reachable from
/// render, and inside `loadSettings` a throw would discard the ENTIRE
/// settings blob to answer one question that has a fine default.
function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function isEffectiveDark(themeMode: ThemeMode): boolean {
  if (themeMode === "dark") return true;
  if (themeMode === "light") return false;
  return systemPrefersDark();
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  // Set right before applying a cross-window update (see the storage
  // listener below) so the persist effect skips re-writing localStorage for
  // it - otherwise each window's zoom (the one field that's deliberately
  // per-window, not synced) would bounce back and forth forever, each
  // window's write-back triggering the other's storage listener in turn.
  const applyingRemoteRef = useRef(false);

  useEffect(() => {
    if (applyingRemoteRef.current) {
      applyingRemoteRef.current = false;
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  // Cross-window sync (2.5): another window's SettingsProvider just wrote a
  // change to the same localStorage key - pick it up here instead of this
  // window silently going stale until its own next unrelated write
  // overwrites the other window's change. `zoom` stays this window's own
  // (see its field comment) - everything else adopts the incoming value.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY || e.newValue === null) return;
      const incoming = loadSettings();
      applyingRemoteRef.current = true;
      setSettingsState((prev) => ({ ...incoming, zoom: prev.zoom }));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    void prefs.setNewDocumentMode(settings.newDocumentMode);
  }, [settings.newDocumentMode]);

  useEffect(() => {
    void prefs.setRestoreSessionOnStartup(settings.restoreSessionOnStartup);
  }, [settings.restoreSessionOnStartup]);

  // An unparseable proxy is rejected by the backend (and requests fall back
  // to a direct connection), so a half-typed host while editing the setting
  // can't wedge anything.
  useEffect(() => {
    const host = settings.proxyHost.trim();
    const port = settings.proxyPort.trim();
    const proxy =
      settings.proxyType !== "none" && host
        ? `${settings.proxyType}://${host}${port ? `:${port}` : ""}`
        : null;
    ai.setAiProxy(proxy).catch(() => {});
  }, [settings.proxyType, settings.proxyHost, settings.proxyPort]);

  // "system" removes the attribute rather than resolving it here, so the
  // @media (prefers-color-scheme) rules in App.css/content-themes.css are
  // what answer - and the app follows an OS switch live, with no listener.
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
      clearThemeChrome();
    }

    const builtin = BUILTIN_CONTENT_THEMES.find(
      (t) => t.id === settings.themeId,
    );
    if (builtin) {
      if (builtin.id === "default") root.removeAttribute("data-content-theme");
      else root.setAttribute("data-content-theme", builtin.id);
      clearInjectedStyle();
      return;
    }

    const userTheme = settings.userThemes.find(
      (t) => t.id === settings.themeId,
    );
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
    let revision = 0;
    const theme = userTheme;

    async function applyUserTheme() {
      // A single-design import has no dark stylesheet, so it keeps its one
      // look in either appearance rather than being half-applied.
      const request = ++revision;
      const variant =
        isEffectiveDark(settings.theme) && theme.hasDark ? "dark" : "light";
      try {
        const css = await themes.loadThemeCss(theme.id, variant);
        if (cancelled || request !== revision) return;
        let styleEl = document.getElementById(
          STYLE_ID,
        ) as HTMLStyleElement | null;
        if (!styleEl) {
          styleEl = document.createElement("style");
          styleEl.id = STYLE_ID;
        }
        styleEl.textContent = css ?? "";
        document.head.appendChild(styleEl);
        applyThemeChrome(css ?? "", isEffectiveDark(settings.theme));
      } catch {
        // Theme file missing/unreadable - leave whatever was there before.
      }
    }

    void applyUserTheme();

    // Injected CSS can't be swapped by a media query - in "system" mode this
    // is what re-picks the variant when the OS flips.
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener("change", applyUserTheme);
    return () => {
      cancelled = true;
      mq?.removeEventListener("change", applyUserTheme);
    };
  }, [settings.themeId, settings.theme, settings.userThemes]);

  function setSettings(patch: Partial<Settings>) {
    setSettingsState((prev) => ({ ...prev, ...patch }));
  }

  const t = strings[settings.language];

  const value = useMemo(() => ({ settings, setSettings, t }), [settings, t]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
