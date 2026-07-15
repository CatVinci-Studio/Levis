import { useEffect, useState } from "react";
import {
  useSettings,
  COMPLETION_TONES,
  type AiProvider,
  type CompletionTone,
  type GrammarStrictness,
  type NewDocumentMode,
  type ProxyType,
} from "./SettingsContext";
import type { Lang, Strings } from "../i18n/strings";
import { ToggleRow, ShortcutRow } from "./sections/controls";
import { UpdateSection, CliCommandSection } from "./sections/general";
import { ThemeSection } from "./sections/theme";
import { ProviderAuthPanel, ApiKeyProviderPanel, CustomProviderPanel } from "./sections/providers";
import {
  AgentModelSection,
  AgentWorkspaceSection,
  AgentSystemPromptSection,
  AgentSkillsSection,
} from "./sections/agent";
import "./SettingsPanel.css";

// The settings dialog shell: category nav + the per-category rows. Anything
// with its own state or backend round-trips lives in sections/ - this file
// only composes them and renders the plain settings.* rows inline.

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
                <ToggleRow
                  label={t.restoreSessionLabel}
                  hint={t.restoreSessionHint}
                  checked={settings.restoreSessionOnStartup}
                  onChange={(v) => setSettings({ restoreSessionOnStartup: v })}
                />
                <CliCommandSection t={t} />
                <UpdateSection t={t} />
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
                    <AgentModelSection t={t} />
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
                  label={t.shortcutFindReplace}
                  action="findReplace"
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
