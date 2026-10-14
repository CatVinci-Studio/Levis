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
import { ai, storage, themes } from "../ipc";
import { readBoot, readLocalJson } from "../storage/boot";
import { importLegacyStorage } from "../storage/legacy-import";
import { trackWrite } from "../storage/pending-writes";
import {
  getUiState,
  setUiState,
  type ThemeChromeCache,
} from "../storage/ui-state";
import { listenToThisWindow } from "../utils/tauri-events";
import { applyThemeChrome, clearThemeChrome } from "../utils/theme-chrome";
import { SettingsSync, type Raw } from "./settings-sync";
import { adaptTyporaCss } from "./typora-compat";

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
/** How wide the text column runs: "auto" widens with the window, "standard"
 *  keeps the classic fixed measure, "full" uses the whole pane. Applied as
 *  `data-content-width` on the root (App.css). */
export type ContentWidth = "auto" | "standard" | "full";
export type ProxyType = "none" | "http" | "https" | "socks5";

/// Keyboard-triggerable actions. Each maps to a normalized combo string
/// (see ../utils/shortcuts) - empty string means "unbound".
export type ShortcutAction =
  | "triggerCompletion"
  | "triggerGrammarCheck"
  | "toggleFloatingChat"
  | "toggleSidebar"
  | "toggleAgentPanel"
  | "toggleSplitView"
  | "toggleZenMode"
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
  toggleAgentPanel: "mod+shift+l",
  toggleSplitView: "mod+shift+e",
  toggleZenMode: "mod+shift+j",
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

/// A user-imported (Typora-style) theme. The actual CSS lives on disk under
/// the app's theme directory (see ../utils/theme-import and the Rust
/// save_theme_css/load_theme_css commands) - only small metadata is kept
/// here in the settings.
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
  /// Where Quick Ask's "open full conversation" goes: the docked panel on
  /// the right (default), or the detached window - for a second monitor.
  /// The panel's own header pops out to the window either way.
  agentExpandToWindow: boolean;
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
  /// ("none" or an empty host means direct connection). Handed to Rust as a
  /// URL (see the effect below), which is what sends the requests.
  proxyType: ProxyType;
  proxyHost: string;
  proxyPort: string;
  typewriterMode: boolean;
  contentWidth: ContentWidth;
  /// The user's own CSS, applied on top of whichever theme is selected -
  /// for small changes (indent, line spacing, a font) without writing a
  /// whole theme. Injected last, so it wins ties with the theme (#13).
  customCss: string;
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
  /// opens a tab in the current window instead. Read by Rust straight from
  /// the settings file (commands/prefs.rs), since window-vs-tab is decided
  /// there, often before any webview exists.
  newDocumentMode: NewDocumentMode;
  /// Whether startup reopens last session's documents (default) or starts
  /// blank. Read by Rust straight from the settings file, since the decision
  /// is made in setup() before any webview exists; this is also what lets an
  /// app-update relaunch (which starts with no file arguments at all) reopen
  /// whatever was open before it.
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
  agentExpandToWindow: false,
  pinAgentWindow: false,
  agentWorkspaceRoot: "",
  proxyType: "none",
  proxyHost: "",
  proxyPort: "",
  typewriterMode: false,
  contentWidth: "auto",
  customCss: "",
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
/** The <style> holding Settings > Theme > Custom CSS. */
const CUSTOM_CSS_STYLE_ID = "levis-user-css";

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

const LANGS = Object.keys(strings) as Lang[];

/** The `lang` attribute for the UI language, which the CSS `:lang()` font
 *  stacks key off (Chinese needs its region to pick Simplified glyphs).
 *  Kept in step with the boot script (src-tauri/src/boot.js). */
export function htmlLang(language: Lang): string {
  return language === "zh" ? "zh-CN" : language;
}

function guessLanguage(): Lang {
  const locale =
    typeof navigator === "undefined" ? "" : navigator.language.toLowerCase();
  return locale.startsWith("zh") ? "zh" : locale.startsWith("ja") ? "ja" : "en";
}

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Stored settings -> a complete, valid `Settings`: defaults for what's
 * missing, and the migrations of older shapes. Nothing stored at all (null,
 * or an empty object) is a brand-new installation; a stored object that is
 * merely missing a field is an existing one from before that field.
 */
export function normaliseSettings(parsed: Raw | null): Settings {
  if (!parsed || Object.keys(parsed).length === 0)
    return { ...DEFAULT_SETTINGS, language: guessLanguage() };
  try {
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
        LEGACY_PROVIDER_IDS[parsed.aiProvider as string] ??
        (parsed.aiProvider as string | undefined) ??
        DEFAULT_SETTINGS.aiProvider,
      agentModels: migrateAgentModels(parsed),
      writingModels: {
        ...(parsed.writingModels as Record<string, string> | undefined),
      },
      agentDefaultMode: ["ask", "edit", "plan"].includes(
        parsed.agentDefaultMode as string,
      )
        ? (parsed.agentDefaultMode as AgentMode)
        : DEFAULT_SETTINGS.agentDefaultMode,
      shortcuts: {
        ...DEFAULT_SETTINGS.shortcuts,
        ...((parsed.shortcuts as Partial<Shortcuts> | undefined) ?? {}),
      },
      // An unknown language (a newer build's, a hand edit) would leave
      // `strings[language]` undefined and take the whole UI down with it.
      language: LANGS.includes(parsed.language as Lang)
        ? (parsed.language as Lang)
        : "en",
      theme: THEME_MODES.includes(parsed.theme as ThemeMode)
        ? (parsed.theme as ThemeMode)
        : DEFAULT_SETTINGS.theme,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** The settings blob localStorage held before the move - still the store
 *  without Rust (the browser dev shim, vitest), and what the one-time
 *  import reads. Left in place after the import, so a downgrade to 0.9.6
 *  still finds it. */
function readLocalSettings(): Raw | null {
  const parsed = readLocalJson(STORAGE_KEY);
  return isRecord(parsed) ? parsed : null;
}

function writeLocalSettings(patch: Raw) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readLocalSettings(), ...patch }),
    );
  } catch {
    // Storage unavailable: the change holds for this session only.
  }
}

// ---------------------------------------------------------------------------
// The store. With Rust behind the page (src/storage/boot.ts), the settings
// live in settings.json, held by Rust: read here from the boot snapshot,
// changed by sending only the fields that changed, and kept in step with
// other windows through "settings-changed" (see settings-sync.ts for who
// wins when). Without it, localStorage, as before the move.
// ---------------------------------------------------------------------------

/** Mirrors SettingsChanged in src-tauri/src/settings.rs. */
interface SettingsChanged {
  rev: number;
  patch: Raw;
  from: string;
}

let sync: SettingsSync | null = null;
let normalised: { raw: Raw; settings: Settings } | null = null;
const remoteListeners = new Set<() => void>();

/** The file-backed store, set up on first use; null without Rust. */
function fileStore(): SettingsSync | null {
  if (sync) return sync;
  const boot = readBoot();
  if (!boot) return null;

  if (boot.legacyImport) {
    // First launch since the move: Rust has nothing yet, localStorage has
    // everything. Use it right away and hand it over; Rust answers with
    // what it kept (another window may have got there first).
    const legacy = normaliseSettings(readLocalSettings()) as unknown as Raw;
    sync = new SettingsSync(legacy, boot.rev);
    void importLegacyStorage(legacy).then((result) => {
      if (result) adopt(result.value, result.rev);
    });
  } else {
    sync = new SettingsSync(boot.settings, boot.rev);
    // The snapshot is from when the window was built - a reload replays an
    // old one, and a change made meanwhile by another window was sent
    // before this page could hear it - so the live values replace it.
    const live =
      Object.keys(boot.settings).length === 0
        ? // Nothing stored (a corrupt settings.json was moved aside, or
          // one Rust can't read is being left alone): write the fresh
          // defaults out now, as a first launch always has, so the next
          // launch doesn't read a half-written file as an old install.
          // Only into fields still missing, though: reloaded later, this
          // window replays the same empty snapshot, and must not put the
          // defaults back over everything changed since.
          trackWrite(
            storage.settingsFillDefaults(
              normaliseSettings(null) as unknown as Raw,
            ),
          )
        : storage.settingsGet();
    live.then((s) => adopt(s.value, s.rev)).catch(() => {});
  }

  void listenToThisWindow<SettingsChanged>("settings-changed", (event) => {
    const { rev, patch, from } = event.payload;
    if (from === boot.label || !sync) return;
    // Zoom is each window's own (see its field comment): saved for the
    // next window to open with, never pushed into ones already open.
    const shared = { ...patch };
    delete shared.zoom;
    if (sync.remote(shared, rev)) notifyRemote();
  });
  return sync;
}

/** Adopts a full snapshot from Rust, keeping this window's zoom. */
function adopt(value: Raw, rev: number) {
  if (!sync) return;
  const next = { ...value };
  if (sync.raw.zoom !== undefined) next.zoom = sync.raw.zoom;
  if (sync.snapshot(next, rev)) notifyRemote();
}

/** Counts the changes notifyRemote has announced, so a provider can tell
 *  whether one came between its first render and its subscription. */
let remoteVersion = 0;

function notifyRemote() {
  remoteVersion += 1;
  for (const fn of remoteListeners) fn();
}

function send(ticket: Map<string, number>) {
  const store = sync;
  if (!store) return;
  const patch: Raw = {};
  for (const key of ticket.keys()) patch[key] = store.raw[key];
  trackWrite(storage.settingsPatch(patch)).then(
    (rev) => store.confirm(ticket, rev),
    () => store.confirm(ticket),
  );
}

/** Saves the fields in `patch` that differ from what's stored.
 *
 *  Every change goes to Rust at once, keystrokes in Custom CSS included:
 *  Rust holds it in memory, coalesces the disk writes (FLUSH_DELAY in
 *  settings.rs) and writes whatever is pending when the app exits. A
 *  debounce here lost the last keystrokes of a quick Cmd+Q, window close or
 *  Dock Quit on macOS: the window was gone before the timer fired, and a
 *  flush from pagehide didn't reach Rust either. The IPC is still
 *  asynchronous, so every close path the app owns waits for the patches
 *  on their way before the window is destroyed (send's trackWrite,
 *  storage/pending-writes.ts). */
function persist(patch: Partial<Settings>) {
  const store = fileStore();
  if (!store) {
    writeLocalSettings(patch);
    return;
  }
  // A field not stored at all reads as its default, so setting it to the
  // default changes nothing either.
  const current = loadSettings() as unknown as Raw;
  const changed: Raw = {};
  for (const [key, value] of Object.entries(patch)) {
    if (JSON.stringify(current[key]) !== JSON.stringify(value))
      changed[key] = value;
  }
  if (Object.keys(changed).length === 0) return;
  send(store.local(changed));
}

/** Calls `fn` whenever another window (or a re-read) changes the settings.
 *  Returns the unsubscribe. */
function subscribeRemote(fn: () => void): () => void {
  if (fileStore()) {
    remoteListeners.add(fn);
    return () => remoteListeners.delete(fn);
  }
  // Fallback: another window's write to the same localStorage key.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY && e.newValue !== null) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/** The current settings, outside React - exported so small standalone
 *  stores (chat-history.ts, clipboard-history.ts) can read a privacy
 *  toggle's current value without depending on context. Includes this
 *  window's latest changes, whether or not they've reached Rust yet. */
export function loadSettings(): Settings {
  const store = fileStore();
  // The fallback re-reads every time: other tabs write it too.
  if (!store) return normaliseSettings(readLocalSettings());
  if (normalised?.raw !== store.raw)
    normalised = { raw: store.raw, settings: normaliseSettings(store.raw) };
  return normalised.settings;
}

/** Forgets the store, for tests that install a different boot snapshot. */
export function resetSettingsStoreForTests(): void {
  sync = null;
  normalised = null;
  remoteListeners.clear();
}

/** Keeps an imported theme's chrome colours for the boot script, which
 *  paints the next window's first frame with them (ui-state.ts's
 *  themeChrome) - written only when they changed, so opening a window
 *  doesn't rewrite ui-state.json. Without Rust there is no boot script. */
function rememberThemeChrome(chrome: ThemeChromeCache) {
  if (!readBoot()) return;
  const cached = getUiState("themeChrome") as
    Partial<ThemeChromeCache> | undefined;
  if (
    cached?.id === chrome.id &&
    cached.dark === chrome.dark &&
    cached.sourceLength === chrome.sourceLength &&
    cached.css === chrome.css
  )
    return;
  setUiState("themeChrome", chrome);
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
  // Read in the same render as the state above.
  const renderedVersion = useRef(remoteVersion);

  useEffect(() => {
    // Without Rust, a first launch writes the whole set of defaults out at
    // once, as it always did: a later partial write must not make the next
    // launch mistake this for an old installation (see normaliseSettings).
    // With Rust, the store does the same (fileStore).
    if (!readBoot() && readLocalSettings() === null)
      writeLocalSettings(loadSettings() as unknown as Raw);
    // Cross-window sync: another window changed something. `zoom` stays
    // this window's own (see its field comment) - everything else adopts
    // the incoming value.
    const adoptStore = () => {
      const incoming = loadSettings();
      setSettingsState((prev) => ({ ...incoming, zoom: prev.zoom }));
    };
    const unsubscribe = subscribeRemote(adoptStore);
    // React runs this effect in a later task than the first render, and the
    // live re-read, the legacy import's answer or another window's change
    // can land in between - reaching the store while nobody is subscribed.
    // Catch up on those now.
    if (remoteVersion !== renderedVersion.current) adoptStore();
    return unsubscribe;
  }, []);

  useEffect(() => {
    document.documentElement.lang = htmlLang(settings.language);
  }, [settings.language]);

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

  useEffect(() => {
    const root = document.documentElement;
    if (settings.contentWidth === "auto")
      root.removeAttribute("data-content-width");
    else root.setAttribute("data-content-width", settings.contentWidth);
  }, [settings.contentWidth]);

  useEffect(() => {
    let styleEl = document.getElementById(
      CUSTOM_CSS_STYLE_ID,
    ) as HTMLStyleElement | null;
    if (!settings.customCss.trim()) {
      styleEl?.remove();
      return;
    }
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = CUSTOM_CSS_STYLE_ID;
    }
    styleEl.textContent = settings.customCss;
    document.head.appendChild(styleEl);
  }, [settings.customCss]);

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
      root.removeAttribute("data-user-theme");
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
    // Turns Levis's own content ornaments off (content-base.css): an
    // imported theme should look the way it does in Typora.
    root.setAttribute("data-user-theme", "");
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
        styleEl.textContent = adaptTyporaCss(css ?? "");
        document.head.appendChild(styleEl);
        const dark = isEffectiveDark(settings.theme);
        let chrome: string | null;
        try {
          chrome = applyThemeChrome(css ?? "", dark);
        } finally {
          // The user's own CSS stays after the theme and the chrome derived
          // from it, whenever they load - the order the boot script gives
          // the first frame, and the one an edit to it leaves.
          const custom = document.getElementById(CUSTOM_CSS_STYLE_ID);
          if (custom) document.head.appendChild(custom);
        }
        if (typeof chrome === "string")
          rememberThemeChrome({
            id: theme.id,
            dark,
            sourceLength: (css ?? "").length,
            css: chrome,
          });
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
    persist(patch);
  }

  const t = strings[settings.language] ?? strings.en;

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
