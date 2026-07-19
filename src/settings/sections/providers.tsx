import { useCallback, useEffect, useMemo, useState } from "react";
import type { Strings } from "../../i18n/strings";
import type { AiProvider } from "../SettingsContext";
import { useSettings } from "../SettingsContext";
import { useCloseOnOutsideClick } from "../../utils/useCloseOnOutsideClick";
import {
  useProviderCatalog,
  type ProviderCatalogEntry,
} from "../../ai/provider-catalog";
import { ChevronIcon } from "../../sidebar/icons";
import { auth, type CustomEndpointConfig } from "../../ipc";

// General > AI Login Settings: two compact disclosure rows (provider, then
// credentials) plus the per-provider account/API-key/custom panels.

function localizedLabel(entry: ProviderCatalogEntry, t: Strings): string {
  return entry.id === "custom" ? t.providerCustom : entry.label;
}

/// Each provider's "is it connected" check speaks a different shape
/// (status-object, bare boolean, or config-or-null) - this normalizes them
/// to one boolean per auth method for the picker's status pill and to decide
/// which auth tab opens by default.
async function fetchConnected(
  entry: ProviderCatalogEntry,
): Promise<{ oauth: boolean; apiKey: boolean }> {
  if (entry.id === "custom") {
    const config = await auth.customEndpointStatus();
    return { oauth: false, apiKey: config !== null };
  }
  const oauth = entry.auth.includes("oauth")
    ? (await auth.oauthStatus(entry.id)).configured
    : false;
  const apiKey = entry.auth.includes("api_key")
    ? entry.keyOptional || (await auth.providerApiKeyStatus(entry.id))
    : false;
  return { oauth, apiKey };
}

interface ConnectedState {
  oauth: boolean;
  apiKey: boolean;
}

/// Two compact rows: the first opens a searchable provider list; the second
/// independently expands login/API-key details for the active provider.
export function ProviderListPanel({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const catalog = useProviderCatalog();
  const [connected, setConnected] = useState<
    Partial<Record<AiProvider, ConnectedState>>
  >({});
  const [open, setOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [query, setQuery] = useState("");
  const popoverRef = useCloseOnOutsideClick<HTMLDivElement>(
    () => setOpen(false),
    true,
  );

  const refreshConnected = useCallback((entry: ProviderCatalogEntry) => {
    fetchConnected(entry)
      .then((state) => setConnected((prev) => ({ ...prev, [entry.id]: state })))
      .catch(() => {});
  }, []);

  useEffect(() => {
    for (const entry of catalog) refreshConnected(entry);
  }, [catalog, refreshConnected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (e) => localizedLabel(e, t).toLowerCase().includes(q) || e.id.includes(q),
    );
  }, [catalog, query, t]);

  const active = catalog.find((e) => e.id === settings.aiProvider);
  const activeConnected = active ? connected[active.id] : undefined;
  const isConnected = !!(activeConnected?.oauth || activeConnected?.apiKey);
  const usesAccountStatus = active?.auth.includes("oauth") ?? false;
  const statusLabel =
    active?.keyOptional && active.id !== "custom"
      ? t.providerNoKeyRequired
      : isConnected
        ? usesAccountStatus
          ? t.accountConnectedAs
          : t.apiKeyConfigured
        : usesAccountStatus
          ? t.accountNotConnected
          : t.providerNotConfigured;

  function selectProvider(id: AiProvider) {
    setSettings({ aiProvider: id });
    setOpen(false);
    setAuthOpen(false);
    setQuery("");
  }

  return (
    <div className="provider-picker">
      <div className="combobox" ref={popoverRef}>
        <button
          type="button"
          className="combobox-trigger"
          onClick={() => setOpen((v) => !v)}
          aria-label={`${t.providerDropdownLabel}: ${active ? localizedLabel(active, t) : settings.aiProvider}`}
        >
          <span className="provider-disclosure-label">
            {t.providerDropdownLabel}
          </span>
          <span className="combobox-trigger-label">
            {active ? localizedLabel(active, t) : settings.aiProvider}
          </span>
          <ChevronIcon className="combobox-caret" />
        </button>
        {open && (
          <div className="combobox-popover">
            <input
              type="text"
              className="combobox-search"
              placeholder={t.providerSearchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <div className="combobox-list">
              {filtered.length === 0 && (
                <div className="combobox-empty">{t.noProvidersFound}</div>
              )}
              {filtered.map((entry) => {
                const state = connected[entry.id];
                const connectedHere = !!(state?.oauth || state?.apiKey);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={`combobox-option${entry.id === settings.aiProvider ? " combobox-option-active" : ""}`}
                    onClick={() => selectProvider(entry.id)}
                  >
                    <span className="combobox-option-label">
                      {localizedLabel(entry, t)}
                    </span>
                    {connectedHere && (
                      <span className="status-dot" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {active && (
        <>
          <button
            type="button"
            className="provider-auth-trigger"
            onClick={() => setAuthOpen((v) => !v)}
            aria-expanded={authOpen}
            aria-label={`${t.authDropdownLabel}: ${statusLabel}`}
          >
            <span className="provider-disclosure-label">
              {t.authDropdownLabel}
            </span>
            <span
              className={`status-pill${isConnected ? " status-pill-connected" : ""}`}
            >
              {statusLabel}
            </span>
            <ChevronIcon
              className={`combobox-caret${authOpen ? " combobox-caret-open" : ""}`}
            />
          </button>
          {authOpen && (
            <div className="provider-panel">
              {active.id === "custom" ? (
                <CustomProviderPanel
                  t={t}
                  onStatusChange={() => refreshConnected(active)}
                />
              ) : (
                <ProviderAuthPanel
                  key={active.id}
                  t={t}
                  entry={active}
                  connected={connected[active.id]}
                  onStatusChange={() => refreshConnected(active)}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/// A provider with one or both of oauth/api_key auth: renders a tab switch
/// when both are available, or just the relevant panel when only one is.
export function ProviderAuthPanel({
  t,
  entry,
  connected,
  onStatusChange,
}: {
  t: Strings;
  entry: ProviderCatalogEntry;
  connected?: ConnectedState;
  onStatusChange: () => void;
}) {
  const hasOauth = entry.auth.includes("oauth");
  const hasApiKey = entry.auth.includes("api_key");
  // Default to whichever method is already connected; oauth otherwise, since
  // it's the richer entitlement and what the backend prefers when both are
  // configured (see ai::route::resolve_openai_auth).
  const [tab, setTab] = useState<"oauth" | "api_key">(() => {
    if (!hasOauth) return "api_key";
    if (!hasApiKey) return "oauth";
    return connected?.apiKey && !connected?.oauth ? "api_key" : "oauth";
  });

  const label = localizedLabel(entry, t);

  return (
    <div>
      {hasOauth && hasApiKey && (
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab${tab === "oauth" ? " auth-tab-active" : ""}`}
            onClick={() => setTab("oauth")}
          >
            {t.authTabAccount}
          </button>
          <button
            type="button"
            className={`auth-tab${tab === "api_key" ? " auth-tab-active" : ""}`}
            onClick={() => setTab("api_key")}
          >
            {t.authTabApiKey}
          </button>
        </div>
      )}
      {hasOauth && (!hasApiKey || tab === "oauth") && (
        <OauthPanel
          t={t}
          providerId={entry.id}
          label={label}
          onStatusChange={onStatusChange}
        />
      )}
      {hasApiKey && (!hasOauth || tab === "api_key") && (
        <ApiKeyProviderPanel
          t={t}
          providerId={entry.id}
          label={label}
          keyOptional={entry.keyOptional}
          onStatusChange={onStatusChange}
        />
      )}
    </div>
  );
}

function OauthPanel({
  t,
  providerId,
  label,
  onStatusChange,
}: {
  t: Strings;
  providerId: string;
  label: string;
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
    auth
      .oauthStatus(providerId)
      .then((s) => setConfigured(s.configured))
      .catch(() => {});
    // onStatusChange identity isn't expected to change per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  async function login() {
    setLoggingIn(true);
    setError(null);
    try {
      const status = await auth.oauthLogin(providerId);
      setConfigured(status.configured);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoggingIn(false);
    }
  }

  async function logout() {
    await auth.oauthLogout(providerId);
    setConfigured(false);
  }

  return (
    <div>
      {error && <div className="settings-error">{error}</div>}
      <div className="settings-row">
        <div>
          <div className="settings-row-label">
            {t.accountLabelTemplate.replace("{name}", label)}
          </div>
          <div className="settings-row-hint">
            {loggingIn
              ? t.loggingIn
              : configured
                ? t.accountConnectedAs
                : t.accountNotConnected}
          </div>
        </div>
        {configured ? (
          <button
            className="text-button settings-inline-button"
            onClick={logout}
          >
            {t.logoutButton}
          </button>
        ) : (
          <button
            className="text-button settings-inline-button"
            onClick={login}
            disabled={loggingIn}
          >
            {t.signInTemplate.replace("{name}", label)}
          </button>
        )}
      </div>
    </div>
  );
}

export function ApiKeyProviderPanel({
  t,
  providerId,
  label,
  keyOptional = false,
  onStatusChange,
}: {
  t: Strings;
  providerId: string;
  label: string;
  keyOptional?: boolean;
  onStatusChange?: (configured: boolean) => void;
}) {
  const [configured, setConfiguredState] = useState(false);
  const [input, setInput] = useState("");

  const setConfigured = (ok: boolean) => {
    setConfiguredState(ok);
    onStatusChange?.(ok);
  };

  useEffect(() => {
    auth.providerApiKeyStatus(providerId).then(setConfigured);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  async function save() {
    if (!input.trim()) return;
    await auth.setProviderApiKey(providerId, input.trim());
    setInput("");
    setConfigured(true);
  }

  async function clear() {
    await auth.clearProviderApiKey(providerId);
    setConfigured(false);
  }

  return (
    <div>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">{label}</div>
          <div className="settings-row-hint">
            {(keyOptional
              ? t.apiKeyOptionalHintTemplate
              : t.apiKeyHintTemplate
            ).replace("{name}", label)}
          </div>
        </div>
        {configured ? (
          <div className="api-key-configured">
            <span className="settings-row-hint">{t.apiKeyConfigured}</span>
            <button
              className="text-button settings-inline-button"
              onClick={clear}
            >
              {t.apiKeyClear}
            </button>
          </div>
        ) : (
          <div className="api-key-input-row">
            <input
              type="password"
              className="settings-text-input api-key-input"
              placeholder={t.apiKeyPlaceholder}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              className="text-button settings-inline-button"
              onClick={save}
            >
              {t.apiKeySave}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function CustomProviderPanel({
  t,
  onStatusChange,
}: {
  t: Strings;
  onStatusChange?: (configured: boolean) => void;
}) {
  const [config, setConfig] = useState<CustomEndpointConfig | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "error">(
    "idle",
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    auth.customEndpointStatus().then((c) => {
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
      const list = await auth.fetchCustomModels(baseUrl, apiKey || null);
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
      await auth.testCustomEndpoint(baseUrl, apiKey || null);
      setStatus("ok");
      setStatusMessage(t.customTestSuccess);
    } catch (err) {
      setStatus("error");
      setStatusMessage(String(err));
    }
  }

  async function save() {
    if (!baseUrl.trim() || !selectedModel.trim()) return;
    await auth.setCustomEndpoint(
      baseUrl.trim(),
      apiKey.trim() || null,
      selectedModel.trim(),
    );
    setConfig({
      base_url: baseUrl.trim(),
      api_key: apiKey.trim() || null,
      model: selectedModel.trim(),
    });
    onStatusChange?.(true);
  }

  async function clear() {
    await auth.clearCustomEndpoint();
    setConfig(null);
    setBaseUrl("");
    setApiKey("");
    setSelectedModel("");
    setModels([]);
    setStatus("idle");
    onStatusChange?.(false);
  }

  return (
    <div>
      {statusMessage && (
        <div
          className={status === "error" ? "settings-error" : "settings-success"}
        >
          {statusMessage}
        </div>
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
            <select
              className="settings-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
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
          <button
            className="text-button settings-inline-button"
            onClick={fetchModels}
            disabled={!baseUrl.trim()}
          >
            {t.customFetchModels}
          </button>
        </div>
      </div>
      <div className="custom-actions-row">
        <button
          className="text-button settings-inline-button"
          onClick={testConnection}
          disabled={!baseUrl.trim()}
        >
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
          <button
            className="text-button settings-inline-button"
            onClick={clear}
          >
            {t.apiKeyClear}
          </button>
        )}
      </div>
    </div>
  );
}
