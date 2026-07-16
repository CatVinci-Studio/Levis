import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Strings } from "../../i18n/strings";
import type { AiProvider } from "../SettingsContext";
import { useSettings } from "../SettingsContext";
import { fetchProviderCatalog, type ProviderCatalogEntry } from "../../ai/provider-catalog";

// The AI category's provider list (pi.dev-style: a row per provider, click
// to expand its auth panel) plus the per-provider account panels themselves.

interface CustomEndpointConfig {
  base_url: string;
  api_key: string | null;
  model: string;
}

/// Mirrors the Rust catalog's static entries (src-tauri/src/ai/catalog.rs) -
/// used as the initial render and as the dev-shim fallback, where
/// `invoke("list_providers")` resolves to `null` instead of the real list.
const FALLBACK_CATALOG: ProviderCatalogEntry[] = [
  { id: "codex", dialect: "openai-responses", auth: "oauth", toolCalling: true },
  { id: "apikey", dialect: "openai-responses", auth: "api_key", toolCalling: true },
  { id: "claude", dialect: "anthropic-messages", auth: "oauth", toolCalling: true },
  { id: "custom", dialect: "openai-chat-completions", auth: "custom", toolCalling: false },
];

const PROVIDER_LABEL_KEY: Record<AiProvider, keyof Strings> = {
  codex: "providerCodex",
  claude: "providerClaude",
  apikey: "providerApiKey",
  custom: "providerCustom",
};

/// Each provider's "is it connected" check speaks a different shape
/// (status-object, bare boolean, or config-or-null) - this normalizes them
/// to one boolean for the list row's status pill.
async function fetchConnected(id: AiProvider): Promise<boolean> {
  switch (id) {
    case "codex":
      return (await invoke<{ configured: boolean }>("codex_auth_status")).configured;
    case "claude":
      return (await invoke<{ configured: boolean }>("claude_auth_status")).configured;
    case "apikey":
      return invoke<boolean>("api_key_status");
    case "custom":
      return (await invoke<CustomEndpointConfig | null>("custom_endpoint_status")) !== null;
  }
}

/// The selectable provider list: one row per catalog entry, showing live
/// connection status and a badge for dialects with tool-calling wired up
/// (propose_edit et al - see catalog.rs). Clicking a row's body expands its
/// auth panel in place; the "Use" button (or "In use" badge) is what
/// actually flips `settings.aiProvider`, kept separate from expand/collapse
/// so browsing other providers' panels doesn't switch the active one.
export function ProviderListPanel({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>(FALLBACK_CATALOG);
  const [connected, setConnected] = useState<Partial<Record<AiProvider, boolean>>>({});
  const [expandedId, setExpandedId] = useState<AiProvider | null>(settings.aiProvider);

  useEffect(() => {
    fetchProviderCatalog()
      .then((list) => {
        if (list?.length) setCatalog(list);
      })
      .catch(() => {});
  }, []);

  const refreshConnected = (id: AiProvider) => {
    fetchConnected(id)
      .then((ok) => setConnected((prev) => ({ ...prev, [id]: ok })))
      .catch(() => {});
  };

  useEffect(() => {
    for (const entry of catalog) refreshConnected(entry.id);
    // catalog only changes once (fallback -> fetched list), not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  return (
    <div className="provider-list">
      {catalog.map((entry) => (
        <div key={entry.id} className={`provider-row${settings.aiProvider === entry.id ? " provider-row-active" : ""}`}>
          <button
            type="button"
            className="provider-row-main"
            onClick={() => setExpandedId((cur) => (cur === entry.id ? null : entry.id))}
          >
            <span className="provider-row-name">{t[PROVIDER_LABEL_KEY[entry.id]]}</span>
            <span className={`provider-row-status${connected[entry.id] ? " provider-row-connected" : ""}`}>
              {connected[entry.id] ? t.accountConnectedAs : t.accountNotConnected}
            </span>
            {entry.toolCalling && <span className="provider-row-badge">{t.providerToolCallingBadge}</span>}
          </button>
          {settings.aiProvider === entry.id ? (
            <span className="provider-row-active-badge">{t.providerActiveBadge}</span>
          ) : (
            <button
              type="button"
              className="text-button settings-inline-button"
              onClick={() => setSettings({ aiProvider: entry.id })}
            >
              {t.providerUseButton}
            </button>
          )}
          {expandedId === entry.id && (
            <div className="provider-row-panel">
              {entry.id === "codex" && (
                <ProviderAuthPanel
                  t={t}
                  accountLabel={t.accountLabel}
                  loginLabel={t.loginButton}
                  statusCommand="codex_auth_status"
                  loginCommand="codex_login"
                  logoutCommand="codex_logout"
                  onStatusChange={(ok) => setConnected((prev) => ({ ...prev, codex: ok }))}
                />
              )}
              {entry.id === "claude" && (
                <ProviderAuthPanel
                  t={t}
                  accountLabel={t.claudeAccountLabel}
                  loginLabel={t.claudeLoginButton}
                  statusCommand="claude_auth_status"
                  loginCommand="claude_login"
                  logoutCommand="claude_logout"
                  onStatusChange={(ok) => setConnected((prev) => ({ ...prev, claude: ok }))}
                />
              )}
              {entry.id === "apikey" && (
                <ApiKeyProviderPanel t={t} onStatusChange={(ok) => setConnected((prev) => ({ ...prev, apikey: ok }))} />
              )}
              {entry.id === "custom" && (
                <CustomProviderPanel t={t} onStatusChange={(ok) => setConnected((prev) => ({ ...prev, custom: ok }))} />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/// Shared shape for the Codex/Claude settings panels - both are a thin
/// "configured?" flag behind a status/login/logout command trio, differing
/// only in which commands and labels they use.
export function ProviderAuthPanel({
  t,
  accountLabel,
  loginLabel,
  statusCommand,
  loginCommand,
  logoutCommand,
  onStatusChange,
}: {
  t: Strings;
  accountLabel: string;
  loginLabel: string;
  statusCommand: string;
  loginCommand: string;
  logoutCommand: string;
  onStatusChange?: (configured: boolean) => void;
}) {
  const [configured, setConfiguredState] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setConfigured = (ok: boolean) => {
    setConfiguredState(ok);
    onStatusChange?.(ok);
  };

  useEffect(() => {
    invoke<{ configured: boolean }>(statusCommand).then((s) => setConfigured(s.configured));
    // onStatusChange identity isn't expected to change per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

export function ApiKeyProviderPanel({ t, onStatusChange }: { t: Strings; onStatusChange?: (configured: boolean) => void }) {
  const [configured, setConfiguredState] = useState(false);
  const [input, setInput] = useState("");

  const setConfigured = (ok: boolean) => {
    setConfiguredState(ok);
    onStatusChange?.(ok);
  };

  useEffect(() => {
    invoke<boolean>("api_key_status").then(setConfigured);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

export function CustomProviderPanel({ t, onStatusChange }: { t: Strings; onStatusChange?: (configured: boolean) => void }) {
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
        onStatusChange?.(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    onStatusChange?.(true);
  }

  async function clear() {
    await invoke("clear_custom_endpoint");
    setConfig(null);
    setBaseUrl("");
    setApiKey("");
    setSelectedModel("");
    setModels([]);
    setStatus("idle");
    onStatusChange?.(false);
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
