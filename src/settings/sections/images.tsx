import { useEffect, useState } from "react";
import { imageHostAuth } from "../../ipc";
import type { Strings } from "../../i18n/strings";
import {
  useSettings,
  type ImageNamingMode,
  type ImageStorageMode,
} from "../SettingsContext";

export function ImageStorageSection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const [token, setToken] = useState("");
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    imageHostAuth
      .tokenStatus()
      .then(setTokenConfigured)
      .catch(() => {});
  }, []);

  async function saveToken() {
    if (!token.trim()) return;
    try {
      await imageHostAuth.setToken(token.trim());
      setToken("");
      setTokenConfigured(true);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function clearToken() {
    try {
      await imageHostAuth.clearToken();
      setTokenConfigured(false);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  const remote = settings.imageStorageMode === "image-host";
  return (
    <>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">{t.imageStorageLabel}</div>
          <div className="settings-row-hint">{t.imageStorageHint}</div>
        </div>
        <select
          className="settings-select"
          value={settings.imageStorageMode}
          onChange={(e) =>
            setSettings({
              imageStorageMode: e.target.value as ImageStorageMode,
            })
          }
        >
          <option value="local">{t.imageStorageLocal}</option>
          <option value="image-host">{t.imageStorageRemote}</option>
        </select>
      </div>

      {remote && (
        <>
          <label className="settings-row image-settings-row">
            <div>
              <div className="settings-row-label">
                {t.imageUploadEndpointLabel}
              </div>
              <div className="settings-row-hint">
                {t.imageUploadEndpointHint}
              </div>
            </div>
            <input
              className="settings-text-input image-settings-input"
              type="url"
              placeholder="https://images.example.com/upload"
              value={settings.imageUploadEndpoint}
              onChange={(e) =>
                setSettings({ imageUploadEndpoint: e.target.value })
              }
            />
          </label>
          <label className="settings-row image-settings-row">
            <div>
              <div className="settings-row-label">
                {t.imageUploadUrlFieldLabel}
              </div>
              <div className="settings-row-hint">
                {t.imageUploadUrlFieldHint}
              </div>
            </div>
            <input
              className="settings-text-input image-settings-input"
              placeholder="url"
              value={settings.imageUploadUrlField}
              onChange={(e) =>
                setSettings({ imageUploadUrlField: e.target.value })
              }
            />
          </label>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">
                {t.imageUploadTokenLabel}
              </div>
              <div className="settings-row-hint">{t.imageUploadTokenHint}</div>
            </div>
            {tokenConfigured ? (
              <div className="api-key-configured">
                <span className="settings-row-hint">{t.apiKeyConfigured}</span>
                <button
                  className="text-button settings-inline-button"
                  onClick={clearToken}
                >
                  {t.apiKeyClear}
                </button>
              </div>
            ) : (
              <div className="api-key-input-row">
                <input
                  type="password"
                  className="settings-text-input api-key-input"
                  placeholder={t.imageUploadTokenPlaceholder}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <button
                  className="text-button settings-inline-button"
                  onClick={saveToken}
                  disabled={!token.trim()}
                >
                  {t.apiKeySave}
                </button>
              </div>
            )}
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">{t.imageNamingLabel}</div>
              <div className="settings-row-hint">{t.imageNamingHint}</div>
            </div>
            <select
              className="settings-select"
              value={settings.imageNamingMode}
              onChange={(e) =>
                setSettings({
                  imageNamingMode: e.target.value as ImageNamingMode,
                })
              }
            >
              <option value="auto">{t.imageNamingAuto}</option>
              <option value="original">{t.imageNamingOriginal}</option>
              <option value="ask">{t.imageNamingAsk}</option>
            </select>
          </div>
          {error && <div className="settings-error">{error}</div>}
        </>
      )}
    </>
  );
}
