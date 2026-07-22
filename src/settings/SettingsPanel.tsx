import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  useSettings,
  COMPLETION_TONES,
  type CompletionTone,
  type GrammarStrictness,
  type NewDocumentMode,
  type ProxyType,
} from "./SettingsContext";
import type { Lang, Strings } from "../i18n/strings";
import { ToggleRow, ShortcutRow } from "./sections/controls";
import { UpdateSection, CliCommandSection } from "./sections/general";
import { ThemeSection } from "./sections/theme";
import { ProviderListPanel } from "./sections/providers";
import {
  AgentModelSection,
  WritingModelSection,
  AgentWorkspaceSection,
  AgentSystemPromptSection,
  AgentSkillsSection,
} from "./sections/agent";
import { PrivacySection } from "./sections/privacy";
import "./SettingsPanel.css";

// The settings dialog shell: category nav + the per-category rows. Anything
// with its own state or backend round-trips lives in sections/ - this file
// only composes them and renders the plain settings.* rows inline.

interface SettingsPanelProps {
  onClose: () => void;
  /** Opens a document in the editor - the agent.md "edit" button uses it. */
  onOpenFile: (path: string) => void;
}

type Category = "general" | "editor" | "ai" | "shortcuts" | "privacy";

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-group">
      <h2 className="settings-group-title">{title}</h2>
      <div className="settings-group-body">{children}</div>
    </section>
  );
}

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
    { id: "editor", label: t.navEditor },
    { id: "ai", label: t.navAi },
    { id: "shortcuts", label: t.navShortcuts },
    { id: "privacy", label: t.navPrivacy },
  ];

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span>{t.settingsTitle}</span>
          <button
            className="icon-button settings-close-button"
            onClick={onClose}
          >
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
                <SettingsGroup title={t.generalBasicsLabel}>
                  <div className="settings-row">
                    <span className="settings-row-label">
                      {t.languageLabel}
                    </span>
                    <select
                      className="settings-select"
                      value={settings.language}
                      onChange={(e) =>
                        setSettings({ language: e.target.value as Lang })
                      }
                    >
                      <option value="en">English</option>
                      <option value="zh">中文</option>
                      <option value="ja">日本語</option>
                    </select>
                  </div>
                  <div className="settings-row">
                    <div>
                      <div className="settings-row-label">
                        {t.newDocumentModeLabel}
                      </div>
                      <div className="settings-row-hint">
                        {t.newDocumentModeHint}
                      </div>
                    </div>
                    <select
                      className="settings-select"
                      value={settings.newDocumentMode}
                      onChange={(e) =>
                        setSettings({
                          newDocumentMode: e.target.value as NewDocumentMode,
                        })
                      }
                    >
                      <option value="window">{t.newDocumentModeWindow}</option>
                      <option value="tab">{t.newDocumentModeTab}</option>
                    </select>
                  </div>
                  <ToggleRow
                    label={t.restoreSessionLabel}
                    hint={t.restoreSessionHint}
                    checked={settings.restoreSessionOnStartup}
                    onChange={(v) =>
                      setSettings({ restoreSessionOnStartup: v })
                    }
                  />
                </SettingsGroup>

                <SettingsGroup title={t.aiAccountLabel}>
                  <ProviderListPanel t={t} />
                </SettingsGroup>

                <SettingsGroup title={t.generalSystemLabel}>
                  <CliCommandSection t={t} />
                  <UpdateSection t={t} />
                </SettingsGroup>
              </>
            )}

            {category === "editor" && (
              <>
                <SettingsGroup title={t.navTheme}>
                  <ThemeSection t={t} />
                </SettingsGroup>
                <SettingsGroup title={t.navMarkdown}>
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
                </SettingsGroup>
              </>
            )}

            {category === "ai" && (
              <>
                <SettingsGroup title={t.writingFeaturesLabel}>
                  <WritingModelSection t={t} />
                  <div className="settings-feature-grid">
                    <div className="settings-feature-block">
                      <ToggleRow
                        label={t.aiCompletionLabel}
                        hint={t.aiCompletionHint}
                        checked={settings.enableCompletion}
                        onChange={(v) => setSettings({ enableCompletion: v })}
                      />
                      {settings.enableCompletion && (
                        <div className="settings-feature-option">
                          <div>
                            <div className="settings-row-label">
                              {t.completionToneLabel}
                            </div>
                            <div className="settings-row-hint">
                              {t.completionToneHint}
                            </div>
                          </div>
                          <select
                            className="settings-select"
                            value={settings.completionTone}
                            onChange={(e) =>
                              setSettings({
                                completionTone: e.target
                                  .value as CompletionTone,
                              })
                            }
                          >
                            {COMPLETION_TONES.map((tone) => (
                              <option key={tone} value={tone}>
                                {t[`completionTone_${tone}` as keyof Strings]}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    <div className="settings-feature-block">
                      <ToggleRow
                        label={t.aiGrammarLabel}
                        hint={t.aiGrammarHint}
                        checked={settings.enableGrammarCheck}
                        onChange={(v) => setSettings({ enableGrammarCheck: v })}
                      />
                      {settings.enableGrammarCheck && (
                        <div className="settings-feature-option">
                          <div>
                            <div className="settings-row-label">
                              {t.grammarStrictnessLabel}
                            </div>
                            <div className="settings-row-hint">
                              {t.grammarStrictnessHint}
                            </div>
                          </div>
                          <select
                            className="settings-select"
                            value={settings.grammarStrictness}
                            onChange={(e) =>
                              setSettings({
                                grammarStrictness: e.target
                                  .value as GrammarStrictness,
                              })
                            }
                          >
                            <option value="typos">
                              {t.grammarStrictnessTypos}
                            </option>
                            <option value="standard">
                              {t.grammarStrictnessStandard}
                            </option>
                            <option value="strict">
                              {t.grammarStrictnessStrict}
                            </option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                </SettingsGroup>

                <SettingsGroup title={t.navAgent}>
                  <ToggleRow
                    label={t.aiAskLabel}
                    hint={t.aiAskHint}
                    checked={settings.enableAskAi}
                    onChange={(v) => setSettings({ enableAskAi: v })}
                  />
                  {settings.enableAskAi && (
                    <>
                      <AgentModelSection t={t} />
                      <ToggleRow
                        label={t.webSearchLabel}
                        hint={t.webSearchHint}
                        checked={settings.enableWebSearch}
                        onChange={(v) => setSettings({ enableWebSearch: v })}
                      />
                      <ToggleRow
                        label={t.editAnimationLabel}
                        hint={t.editAnimationHint}
                        checked={settings.enableEditAnimation}
                        onChange={(v) =>
                          setSettings({ enableEditAnimation: v })
                        }
                      />
                      <AgentWorkspaceSection t={t} />
                      <AgentSystemPromptSection
                        t={t}
                        onOpenFile={onOpenFile}
                        onClose={onClose}
                      />
                      <AgentSkillsSection t={t} />
                    </>
                  )}
                </SettingsGroup>

                <SettingsGroup title={t.proxyLabel}>
                  <div className="settings-proxy-row">
                    <select
                      className="settings-select"
                      value={settings.proxyType}
                      onChange={(e) =>
                        setSettings({ proxyType: e.target.value as ProxyType })
                      }
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
                          onChange={(e) =>
                            setSettings({ proxyHost: e.target.value })
                          }
                        />
                        <input
                          type="text"
                          className="settings-text-input settings-proxy-port"
                          placeholder={t.proxyPortPlaceholder}
                          value={settings.proxyPort}
                          onChange={(e) =>
                            setSettings({ proxyPort: e.target.value })
                          }
                        />
                      </>
                    )}
                  </div>
                </SettingsGroup>
              </>
            )}

            {category === "privacy" && <PrivacySection t={t} />}

            {category === "shortcuts" && (
              <>
                <SettingsGroup title={t.shortcutAiGroupLabel}>
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
                </SettingsGroup>
                <SettingsGroup title={t.shortcutEditorGroupLabel}>
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
                </SettingsGroup>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
