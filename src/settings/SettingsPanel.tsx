import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  useSettings,
  BUILTIN_CONTENT_THEMES,
  COMPLETION_TONES,
  type AiProvider,
  type CompletionTone,
  type GrammarStrictness,
  type NewDocumentMode,
  type ProxyType,
  type ShortcutAction,
  type Shortcuts,
  type UserThemeMeta,
} from "./SettingsContext";
import type { Lang, Strings } from "../i18n/strings";
import type { AgentSkill } from "../ai/types";
import { comboFromEvent, isBindableCombo, formatCombo } from "../utils/shortcuts";
import { importThemeCss } from "../utils/theme-import";
import "./SettingsPanel.css";

interface CustomEndpointConfig {
  base_url: string;
  api_key: string | null;
  model: string;
}

interface SettingsPanelProps {
  onClose: () => void;
  /** Opens a document in the editor - the agent.md "edit" button uses it. */
  onOpenFile: (path: string) => void;
}

type Category = "general" | "theme" | "markdown" | "ai" | "agent" | "shortcuts";

export function SettingsPanel({ onClose, onOpenFile }: SettingsPanelProps) {
  const { settings, setSettings, t } = useSettings();
  const [category, setCategory] = useState<Category>("general");

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const categories: { id: Category; label: string }[] = [
    { id: "general", label: t.navGeneral },
    { id: "theme", label: t.navTheme },
    { id: "markdown", label: t.navMarkdown },
    { id: "ai", label: t.navAi },
    { id: "agent", label: t.navAgent },
    { id: "shortcuts", label: t.navShortcuts },
  ];

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span>{t.settingsTitle}</span>
          <button className="icon-button settings-close-button" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav">
            {categories.map((c) => (
              <button
                key={c.id}
                className={`settings-nav-item ${category === c.id ? "settings-nav-item-active" : ""}`}
                onClick={() => setCategory(c.id)}
              >
                {c.label}
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {category === "general" && (
              <>
                <div className="settings-row">
                  <span className="settings-row-label">{t.languageLabel}</span>
                  <select
                    value={settings.language}
                    onChange={(e) => setSettings({ language: e.target.value as Lang })}
                  >
                    <option value="en">English</option>
                    <option value="zh">中文</option>
                    <option value="ja">日本語</option>
                  </select>
                </div>
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">{t.newDocumentModeLabel}</div>
                    <div className="settings-row-hint">{t.newDocumentModeHint}</div>
                  </div>
                  <select
                    value={settings.newDocumentMode}
                    onChange={(e) => setSettings({ newDocumentMode: e.target.value as NewDocumentMode })}
                  >
                    <option value="window">{t.newDocumentModeWindow}</option>
                    <option value="tab">{t.newDocumentModeTab}</option>
                  </select>
                </div>
                <UpdateSection t={t} />
                <CliCommandSection t={t} />
              </>
            )}

            {category === "theme" && <ThemeSection t={t} />}

            {category === "markdown" && (
              <>
                <ToggleRow
                  label={t.enableMathLabel}
                  hint={t.enableMathHint}
                  checked={settings.enableMath}
                  onChange={(v) => setSettings({ enableMath: v })}
                />
                <ToggleRow
                  label={t.enableMermaidLabel}
                  hint={t.enableMermaidHint}
                  checked={settings.enableMermaid}
                  onChange={(v) => setSettings({ enableMermaid: v })}
                />
              </>
            )}

            {category === "ai" && (
              <>
                <div className="settings-section-label">{t.aiAccountLabel}</div>
                <div className="settings-row">
                  <span className="settings-row-label">{t.providerLabel}</span>
                  <select
                    value={settings.aiProvider}
                    onChange={(e) => setSettings({ aiProvider: e.target.value as AiProvider })}
                  >
                    <option value="codex">{t.providerCodex}</option>
                    <option value="claude">{t.providerClaude}</option>
                    <option value="apikey">{t.providerApiKey}</option>
                    <option value="custom">{t.providerCustom}</option>
                  </select>
                </div>

                {settings.aiProvider === "codex" && (
                  <ProviderAuthPanel
                    t={t}
                    accountLabel={t.accountLabel}
                    loginLabel={t.loginButton}
                    statusCommand="codex_auth_status"
                    loginCommand="codex_login"
                    logoutCommand="codex_logout"
                  />
                )}
                {settings.aiProvider === "claude" && (
                  <ProviderAuthPanel
                    t={t}
                    accountLabel={t.claudeAccountLabel}
                    loginLabel={t.claudeLoginButton}
                    statusCommand="claude_auth_status"
                    loginCommand="claude_login"
                    logoutCommand="claude_logout"
                  />
                )}
                {settings.aiProvider === "apikey" && <ApiKeyProviderPanel t={t} />}
                {settings.aiProvider === "custom" && <CustomProviderPanel t={t} />}

                <div className="settings-section-label">{t.proxyLabel}</div>
                <div className="settings-field-stack">
                  <div className="settings-row-hint">{t.proxyHint}</div>
                  <div className="settings-proxy-row">
                    <select
                      value={settings.proxyType}
                      onChange={(e) => setSettings({ proxyType: e.target.value as ProxyType })}
                    >
                      <option value="none">{t.proxyTypeNone}</option>
                      <option value="http">HTTP</option>
                      <option value="https">HTTPS</option>
                      <option value="socks5">SOCKS5</option>
                    </select>
                    {settings.proxyType !== "none" && (
                      <>
                        <input
                          type="text"
                          className="settings-text-input settings-proxy-host"
                          placeholder={t.proxyHostPlaceholder}
                          value={settings.proxyHost}
                          onChange={(e) => setSettings({ proxyHost: e.target.value })}
                        />
                        <input
                          type="text"
                          className="settings-text-input settings-proxy-port"
                          placeholder={t.proxyPortPlaceholder}
                          value={settings.proxyPort}
                          onChange={(e) => setSettings({ proxyPort: e.target.value })}
                        />
                      </>
                    )}
                  </div>
                </div>

                <div className="settings-section-label">{t.aiFeaturesLabel}</div>
                <ToggleRow
                  label={t.aiCompletionLabel}
                  hint={t.aiCompletionHint}
                  checked={settings.enableCompletion}
                  onChange={(v) => setSettings({ enableCompletion: v })}
                />
                {settings.enableCompletion && (
                  <div className="settings-row">
                    <div>
                      <div className="settings-row-label">{t.completionToneLabel}</div>
                      <div className="settings-row-hint">{t.completionToneHint}</div>
                    </div>
                    <select
                      value={settings.completionTone}
                      onChange={(e) => setSettings({ completionTone: e.target.value as CompletionTone })}
                    >
                      {COMPLETION_TONES.map((tone) => (
                        <option key={tone} value={tone}>
                          {t[`completionTone_${tone}` as keyof Strings]}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <ToggleRow
                  label={t.aiGrammarLabel}
                  hint={t.aiGrammarHint}
                  checked={settings.enableGrammarCheck}
                  onChange={(v) => setSettings({ enableGrammarCheck: v })}
                />
                {settings.enableGrammarCheck && (
                  <div className="settings-row">
                    <div>
                      <div className="settings-row-label">{t.grammarStrictnessLabel}</div>
                      <div className="settings-row-hint">{t.grammarStrictnessHint}</div>
                    </div>
                    <select
                      value={settings.grammarStrictness}
                      onChange={(e) => setSettings({ grammarStrictness: e.target.value as GrammarStrictness })}
                    >
                      <option value="typos">{t.grammarStrictnessTypos}</option>
                      <option value="standard">{t.grammarStrictnessStandard}</option>
                      <option value="strict">{t.grammarStrictnessStrict}</option>
                    </select>
                  </div>
                )}
              </>
            )}

            {category === "agent" && (
              <>
                <ToggleRow
                  label={t.aiAskLabel}
                  hint={t.aiAskHint}
                  checked={settings.enableAskAi}
                  onChange={(v) => setSettings({ enableAskAi: v })}
                />
                {settings.enableAskAi && (
                  <>
                    <ToggleRow
                      label={t.webSearchLabel}
                      hint={t.webSearchHint}
                      checked={settings.enableWebSearch}
                      onChange={(v) => setSettings({ enableWebSearch: v })}
                    />
                    <AgentWorkspaceSection t={t} />
                    <AgentSystemPromptSection t={t} onOpenFile={onOpenFile} onClose={onClose} />
                    <AgentSkillsSection t={t} />
                  </>
                )}
              </>
            )}

            {category === "shortcuts" && (
              <>
                <ShortcutRow
                  label={t.shortcutTriggerCompletion}
                  action="triggerCompletion"
                  shortcuts={settings.shortcuts}
                  setSettings={setSettings}
                  t={t}
                />
                <ShortcutRow
                  label={t.shortcutTriggerGrammarCheck}
                  action="triggerGrammarCheck"
                  shortcuts={settings.shortcuts}
                  setSettings={setSettings}
                  t={t}
                />
                <ShortcutRow
                  label={t.shortcutToggleFloatingChat}
                  action="toggleFloatingChat"
                  shortcuts={settings.shortcuts}
                  setSettings={setSettings}
                  t={t}
                />
                <ShortcutRow
                  label={t.shortcutToggleSidebar}
                  action="toggleSidebar"
                  shortcuts={settings.shortcuts}
                  setSettings={setSettings}
                  t={t}
                />
                <ShortcutRow
                  label={t.shortcutToggleSourceMode}
                  action="toggleSourceMode"
                  shortcuts={settings.shortcuts}
                  setSettings={setSettings}
                  t={t}
                />
                <ShortcutRow
                  label={t.shortcutToggleTypewriterMode}
                  action="toggleTypewriterMode"
                  shortcuts={settings.shortcuts}
                  setSettings={setSettings}
                  t={t}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Current version + a manual "Check for Updates" button. The background
 * check (useAppUpdate) is silent about being up to date and about errors;
 * a manual check is the opposite - the user asked, so "already latest" and
 * failures both get an explicit answer here.
 */
function UpdateSection({ t }: { t: Strings }) {
  const [version, setVersion] = useState("");
  const [phase, setPhase] = useState<"idle" | "checking" | "latest" | "available" | "downloading" | "error">("idle");
  const [message, setMessage] = useState("");
  const [update, setUpdate] = useState<Update | null>(null);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  async function checkNow() {
    setPhase("checking");
    setMessage("");
    try {
      const found = await check();
      if (found) {
        setUpdate(found);
        setPhase("available");
        setMessage(`${t.updateAvailable} v${found.version}`);
      } else {
        setPhase("latest");
        setMessage(t.updateLatest);
      }
    } catch (err) {
      setPhase("error");
      setMessage(`${t.updateFailed} ${String(err)}`);
    }
  }

  async function install() {
    if (!update) return;
    setPhase("downloading");
    setMessage(t.updateDownloading);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (err) {
      setPhase("error");
      setMessage(`${t.updateFailed} ${String(err)}`);
    }
  }

  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">
          {t.updateVersionLabel} {version && `v${version}`}
        </div>
        {message && <div className={phase === "error" ? "settings-error" : "settings-row-hint"}>{message}</div>}
      </div>
      <div className="shortcut-row-controls">
        {phase === "available" || phase === "downloading" ? (
          <button className="text-button settings-inline-button" onClick={install} disabled={phase === "downloading"}>
            {t.updateInstall}
          </button>
        ) : (
          <button className="text-button settings-inline-button" onClick={checkNow} disabled={phase === "checking"}>
            {phase === "checking" ? t.updateChecking : t.updateCheckButton}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Startup already tries a silent, non-privileged install (works when
 * /usr/local/bin happens to be user-writable, e.g. via Homebrew). This row
 * is for the common case where that silently failed: it shows current
 * status and, on click, retries through an admin-privileged prompt.
 */
function CliCommandSection({ t }: { t: Strings }) {
  const [installed, setInstalled] = useState(false);
  const [phase, setPhase] = useState<"idle" | "installing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<boolean>("cli_command_status").then(setInstalled);
  }, []);

  async function install() {
    setPhase("installing");
    setError(null);
    try {
      await invoke("install_cli_command");
      setInstalled(true);
      setPhase("idle");
    } catch (err) {
      setPhase("error");
      setError(String(err));
    }
  }

  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">{t.cliCommandLabel}</div>
        <div className="settings-row-hint">{t.cliCommandHint}</div>
        {error && <div className="settings-error">{t.cliCommandFailed} {error}</div>}
      </div>
      <div className="shortcut-row-controls">
        {!error && <span className="settings-row-hint">{installed ? t.cliCommandInstalled : t.cliCommandNotInstalled}</span>}
        <button className="text-button settings-inline-button" onClick={install} disabled={phase === "installing"}>
          {phase === "installing"
            ? t.cliCommandInstalling
            : installed
              ? t.cliCommandReinstallButton
              : t.cliCommandInstallButton}
        </button>
      </div>
    </div>
  );
}

function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function ThemeSection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One step: pick a CSS file and it's imported and selected right away,
  // named after the file. (A dark variant can still exist in the data model
  // for themes that shipped one; imports are single-file.)
  async function importTheme() {
    const picked = await invoke<string | null>("open_css_file_dialog");
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const id = `user-${Date.now()}`;
      const css = await importThemeCss(picked);
      await invoke("save_theme_css", { id, variant: "light", css });
      const meta: UserThemeMeta = { id, name: basename(picked).replace(/\.css$/i, ""), hasDark: false };
      setSettings({ userThemes: [...settings.userThemes, meta], themeId: id });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteCurrentTheme() {
    const current = settings.userThemes.find((th) => th.id === settings.themeId);
    if (!current) return;
    await invoke("delete_theme", { id: current.id });
    setSettings({
      userThemes: settings.userThemes.filter((th) => th.id !== current.id),
      themeId: "default",
    });
  }

  const isUserThemeSelected = settings.userThemes.some((th) => th.id === settings.themeId);

  return (
    <div className="settings-provider-panel">
      {error && <div className="settings-error">{error}</div>}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">{t.contentThemeLabel}</div>
          <div className="settings-row-hint">{t.contentThemeHint}</div>
        </div>
        <div className="shortcut-row-controls">
          <select value={settings.themeId} onChange={(e) => setSettings({ themeId: e.target.value })}>
            {BUILTIN_CONTENT_THEMES.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
            {settings.userThemes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </select>
          {isUserThemeSelected && (
            <button className="text-button settings-inline-button" onClick={deleteCurrentTheme}>
              {t.themeDeleteButton}
            </button>
          )}
          <button className="text-button settings-inline-button" onClick={importTheme} disabled={busy}>
            {t.themeImportButton}
          </button>
        </div>
      </div>
    </div>
  );
}

/// The agent workspace is configured through files, not settings controls -
/// this section just explains the .levis/ convention and opens the global
/// folder. The full write-up lives in Help > AI Agent Guide.
function AgentWorkspaceSection({ t }: { t: Strings }) {
  const { settings } = useSettings();
  const [error, setError] = useState<string | null>(null);

  async function openFolder() {
    try {
      // Language picks the starter agent.md template on first use.
      await invoke("open_global_agent_dir", { lang: settings.language });
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <>
      <div className="settings-section-label">{t.agentWorkspaceLabel}</div>
      <div className="settings-row">
        <div>
          <div className="settings-row-hint settings-workspace-hint">{t.agentWorkspaceHint}</div>
          {error && <div className="settings-error">{error}</div>}
        </div>
        <button className="text-button settings-inline-button" onClick={openFolder}>
          {t.agentWorkspaceOpenButton}
        </button>
      </div>
    </>
  );
}

/// The GLOBAL agent.md - the standing instructions in every chat's system
/// prompt. Levis IS a markdown editor, so the button just opens the file as
/// a document (creating an empty starter on first use) instead of embedding
/// a bespoke editor here. A document folder's .levis/agent.md layers on top
/// and stays file-managed.
function AgentSystemPromptSection({ t, onOpenFile, onClose }: { t: Strings; onOpenFile: (path: string) => void; onClose: () => void }) {
  const { settings } = useSettings();
  const [error, setError] = useState<string | null>(null);

  async function editAgentMd() {
    try {
      // Language picks the starter agent.md template on first use.
      const path = await invoke<string>("ensure_global_agent_md", { lang: settings.language });
      onClose(); // the editor is behind the settings panel
      onOpenFile(path);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <>
      <div className="settings-section-label">{t.agentSystemPromptLabel}</div>
      <div className="settings-row">
        <div>
          <div className="settings-row-hint settings-workspace-hint">{t.agentSystemPromptHint}</div>
          {error && <div className="settings-error">{error}</div>}
        </div>
        <button className="text-button settings-inline-button" onClick={editAgentMd}>
          {t.agentSystemPromptEdit}
        </button>
      </div>
    </>
  );
}

/// The GLOBAL skill list, plus an import button that copies a .md skill
/// file into the global skills folder. Per-document .levis/skills still
/// layer on top when chatting - this section only manages the global set.
function AgentSkillsSection({ t }: { t: Strings }) {
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [error, setError] = useState<string | null>(null);

  // docPath null = the global layer only, which is exactly what's editable here.
  useEffect(() => {
    invoke<{ skills: AgentSkill[] } | null>("load_agent_workspace", { docPath: null })
      .then((ws) => setSkills(ws?.skills ?? []))
      .catch(() => {});
  }, []);

  async function importSkill() {
    try {
      const updated = await invoke<AgentSkill[] | null>("import_agent_skill");
      if (updated) setSkills(updated);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <>
      <div className="settings-section-label">{t.agentSkillsLabel}</div>
      <div className="settings-row">
        <div>
          <div className="settings-row-hint settings-workspace-hint">{t.agentSkillsHint}</div>
          {error && <div className="settings-error">{error}</div>}
        </div>
        <button className="text-button settings-inline-button" onClick={importSkill}>
          {t.agentSkillsImport}
        </button>
      </div>
      {skills.length === 0 ? (
        <div className="settings-row-hint">{t.agentSkillsEmpty}</div>
      ) : (
        <div className="settings-skill-list">
          {skills.map((skill) => (
            <div key={skill.name} className="settings-skill-item">
              <span className="settings-skill-name">/{skill.name}</span>
              <span className="settings-skill-desc">{skill.description || skill.prompt}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/// Shared shape for the Codex/Claude settings panels - both are a thin
/// "configured?" flag behind a status/login/logout command trio, differing
/// only in which commands and labels they use.
function ProviderAuthPanel({
  t,
  accountLabel,
  loginLabel,
  statusCommand,
  loginCommand,
  logoutCommand,
}: {
  t: Strings;
  accountLabel: string;
  loginLabel: string;
  statusCommand: string;
  loginCommand: string;
  logoutCommand: string;
}) {
  const [configured, setConfigured] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<{ configured: boolean }>(statusCommand).then((s) => setConfigured(s.configured));
  }, [statusCommand]);

  async function login() {
    setLoggingIn(true);
    setError(null);
    try {
      const status = await invoke<{ configured: boolean }>(loginCommand);
      setConfigured(status.configured);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoggingIn(false);
    }
  }

  async function logout() {
    await invoke(logoutCommand);
    setConfigured(false);
  }

  return (
    <div className="settings-provider-panel">
      {error && <div className="settings-error">{error}</div>}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">{accountLabel}</div>
          <div className="settings-row-hint">
            {loggingIn ? t.loggingIn : configured ? t.accountConnectedAs : t.accountNotConnected}
          </div>
        </div>
        {configured ? (
          <button className="text-button settings-inline-button" onClick={logout}>
            {t.logoutButton}
          </button>
        ) : (
          <button className="text-button settings-inline-button" onClick={login} disabled={loggingIn}>
            {loginLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function ApiKeyProviderPanel({ t }: { t: Strings }) {
  const [configured, setConfigured] = useState(false);
  const [input, setInput] = useState("");

  useEffect(() => {
    invoke<boolean>("api_key_status").then(setConfigured);
  }, []);

  async function save() {
    if (!input.trim()) return;
    await invoke("set_api_key", { key: input.trim() });
    setInput("");
    setConfigured(true);
  }

  async function clear() {
    await invoke("clear_api_key");
    setConfigured(false);
  }

  return (
    <div className="settings-provider-panel">
      <div className="settings-row">
        <div>
          <div className="settings-row-label">{t.apiKeyLabel}</div>
          <div className="settings-row-hint">{t.apiKeyHint}</div>
        </div>
        {configured ? (
          <div className="api-key-configured">
            <span className="settings-row-hint">{t.apiKeyConfigured}</span>
            <button className="text-button settings-inline-button" onClick={clear}>
              {t.apiKeyClear}
            </button>
          </div>
        ) : (
          <div className="api-key-input-row">
            <input
              type="password"
              className="api-key-input"
              placeholder={t.apiKeyPlaceholder}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button className="text-button settings-inline-button" onClick={save}>
              {t.apiKeySave}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CustomProviderPanel({ t }: { t: Strings }) {
  const [config, setConfig] = useState<CustomEndpointConfig | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    invoke<CustomEndpointConfig | null>("custom_endpoint_status").then((c) => {
      if (c) {
        setConfig(c);
        setBaseUrl(c.base_url);
        setApiKey(c.api_key ?? "");
        setSelectedModel(c.model);
      }
    });
  }, []);

  async function fetchModels() {
    setStatus("checking");
    setStatusMessage(null);
    try {
      const list = await invoke<string[]>("fetch_custom_models", {
        baseUrl,
        apiKey: apiKey || null,
      });
      setModels(list);
      setStatus("ok");
      if (!selectedModel && list.length > 0) setSelectedModel(list[0]);
    } catch (err) {
      setStatus("error");
      setStatusMessage(String(err));
    }
  }

  async function testConnection() {
    setStatus("checking");
    setStatusMessage(null);
    try {
      await invoke("test_custom_endpoint", { baseUrl, apiKey: apiKey || null });
      setStatus("ok");
      setStatusMessage(t.customTestSuccess);
    } catch (err) {
      setStatus("error");
      setStatusMessage(String(err));
    }
  }

  async function save() {
    if (!baseUrl.trim() || !selectedModel.trim()) return;
    await invoke("set_custom_endpoint", {
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim() || null,
      model: selectedModel.trim(),
    });
    setConfig({ base_url: baseUrl.trim(), api_key: apiKey.trim() || null, model: selectedModel.trim() });
  }

  async function clear() {
    await invoke("clear_custom_endpoint");
    setConfig(null);
    setBaseUrl("");
    setApiKey("");
    setSelectedModel("");
    setModels([]);
    setStatus("idle");
  }

  return (
    <div className="settings-provider-panel">
      {statusMessage && (
        <div className={status === "error" ? "settings-error" : "settings-success"}>{statusMessage}</div>
      )}
      <div className="settings-field">
        <label className="settings-field-label">{t.customBaseUrlLabel}</label>
        <input
          type="text"
          className="settings-text-input"
          placeholder={t.customBaseUrlPlaceholder}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">{t.customApiKeyLabel}</label>
        <input
          type="password"
          className="settings-text-input"
          placeholder={t.apiKeyPlaceholder}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>
      <div className="settings-field">
        <label className="settings-field-label">{t.customModelLabel}</label>
        <div className="custom-model-row">
          {models.length > 0 ? (
            <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              className="settings-text-input"
              placeholder={t.customModelPlaceholder}
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            />
          )}
          <button className="text-button settings-inline-button" onClick={fetchModels} disabled={!baseUrl.trim()}>
            {t.customFetchModels}
          </button>
        </div>
      </div>
      <div className="custom-actions-row">
        <button className="text-button settings-inline-button" onClick={testConnection} disabled={!baseUrl.trim()}>
          {t.customTestConnection}
        </button>
        <button
          className="text-button settings-inline-button"
          onClick={save}
          disabled={!baseUrl.trim() || !selectedModel.trim()}
        >
          {t.customSave}
        </button>
        {config && (
          <button className="text-button settings-inline-button" onClick={clear}>
            {t.apiKeyClear}
          </button>
        )}
      </div>
    </div>
  );
}

function ShortcutRow({
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
          {recording ? t.shortcutRecording : combo ? formatCombo(combo) : t.shortcutUnset}
        </button>
        {combo && !recording && (
          <button className="text-button settings-inline-button" onClick={clear}>
            {t.shortcutClear}
          </button>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
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
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
