import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings, type AiProvider, type ThemeMode } from "./SettingsContext";
import type { Lang, Strings } from "../i18n/strings";
import "./SettingsPanel.css";

interface AuthStatus {
  configured: boolean;
  account_id: string | null;
}

interface ClaudeAuthStatus {
  configured: boolean;
}

interface CustomEndpointConfig {
  base_url: string;
  api_key: string | null;
  model: string;
}

interface SettingsPanelProps {
  onClose: () => void;
}

type Tab = "interface" | "ai";

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { settings, setSettings, t } = useSettings();
  const [tab, setTab] = useState<Tab>("interface");

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span>{t.settingsTitle}</span>
          <button className="icon-button settings-close-button" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="settings-tabs">
          <button
            className={`settings-tab ${tab === "interface" ? "settings-tab-active" : ""}`}
            onClick={() => setTab("interface")}
          >
            {t.tabInterface}
          </button>
          <button
            className={`settings-tab ${tab === "ai" ? "settings-tab-active" : ""}`}
            onClick={() => setTab("ai")}
          >
            {t.tabAi}
          </button>
        </div>

        <div className="settings-body">
          {tab === "interface" && (
            <>
              <div className="settings-row">
                <span className="settings-row-label">{t.themeLabel}</span>
                <select
                  value={settings.theme}
                  onChange={(e) => setSettings({ theme: e.target.value as ThemeMode })}
                >
                  <option value="system">{t.themeSystem}</option>
                  <option value="light">{t.themeLight}</option>
                  <option value="dark">{t.themeDark}</option>
                </select>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">{t.languageLabel}</span>
                <select
                  value={settings.language}
                  onChange={(e) => setSettings({ language: e.target.value as Lang })}
                >
                  <option value="en">English</option>
                  <option value="zh">中文</option>
                </select>
              </div>
            </>
          )}

          {tab === "ai" && (
            <>
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

              {settings.aiProvider === "codex" && <CodexProviderPanel t={t} />}
              {settings.aiProvider === "claude" && <ClaudeProviderPanel t={t} />}
              {settings.aiProvider === "apikey" && <ApiKeyProviderPanel t={t} />}
              {settings.aiProvider === "custom" && <CustomProviderPanel t={t} />}

              <div className="settings-section-label">{t.aiFeaturesLabel}</div>
              <ToggleRow
                label={t.aiCompletionLabel}
                hint={t.aiCompletionHint}
                checked={settings.enableCompletion}
                onChange={(v) => setSettings({ enableCompletion: v })}
              />
              <ToggleRow
                label={t.aiGrammarLabel}
                hint={t.aiGrammarHint}
                checked={settings.enableGrammarCheck}
                onChange={(v) => setSettings({ enableGrammarCheck: v })}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CodexProviderPanel({ t }: { t: Strings }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<AuthStatus>("codex_auth_status").then(setStatus);
  }, []);

  async function login() {
    setLoggingIn(true);
    setError(null);
    try {
      setStatus(await invoke<AuthStatus>("codex_login"));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoggingIn(false);
    }
  }

  async function logout() {
    await invoke("codex_logout");
    setStatus({ configured: false, account_id: null });
  }

  return (
    <div className="settings-provider-panel">
      {error && <div className="settings-error">{error}</div>}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">{t.accountLabel}</div>
          <div className="settings-row-hint">
            {loggingIn ? t.loggingIn : status?.configured ? t.accountConnectedAs : t.accountNotConnected}
          </div>
        </div>
        {status?.configured ? (
          <button className="text-button settings-inline-button" onClick={logout}>
            {t.logoutButton}
          </button>
        ) : (
          <button className="text-button settings-inline-button" onClick={login} disabled={loggingIn}>
            {t.loginButton}
          </button>
        )}
      </div>
    </div>
  );
}

function ClaudeProviderPanel({ t }: { t: Strings }) {
  const [status, setStatus] = useState<ClaudeAuthStatus | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<ClaudeAuthStatus>("claude_auth_status").then(setStatus);
  }, []);

  async function login() {
    setLoggingIn(true);
    setError(null);
    try {
      setStatus(await invoke<ClaudeAuthStatus>("claude_login"));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoggingIn(false);
    }
  }

  async function logout() {
    await invoke("claude_logout");
    setStatus({ configured: false });
  }

  return (
    <div className="settings-provider-panel">
      {error && <div className="settings-error">{error}</div>}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">{t.claudeAccountLabel}</div>
          <div className="settings-row-hint">
            {loggingIn ? t.loggingIn : status?.configured ? t.accountConnectedAs : t.accountNotConnected}
          </div>
        </div>
        {status?.configured ? (
          <button className="text-button settings-inline-button" onClick={logout}>
            {t.logoutButton}
          </button>
        ) : (
          <button className="text-button settings-inline-button" onClick={login} disabled={loggingIn}>
            {t.claudeLoginButton}
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
