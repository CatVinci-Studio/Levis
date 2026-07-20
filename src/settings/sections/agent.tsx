import { useCallback, useEffect, useState } from "react";
import { useSettings } from "../SettingsContext";
import type { Strings } from "../../i18n/strings";
import type { AgentSkill } from "../../ai/types";
import {
  OPENAI_OAUTH_AGENT_MODEL_PRESETS,
  OPENAI_OAUTH_WRITING_MODEL_PRESETS,
} from "../agent-models";
import { useProviderCatalog } from "../../ai/provider-catalog";
import { ai, auth } from "../../ipc";

// The Agent category's sections. The agent workspace itself is file-managed
// (the .levis/ convention) - these sections mostly open folders/files rather
// than embedding editors; the full write-up lives in Help > AI Agent Guide.

/// Model picker for the agent chat, for whichever provider is active in the
/// AI tab. Seeded from the catalog's `knownModels` (a small pre-supplied
/// list, same idea as pi.dev's models.json) so the dropdown is never empty;
/// "Fetch Models" adds any live-fetched extras on top, except where the
/// catalog marks listing unsupported or where "sign in with ChatGPT" is
/// active (that OAuth token can't list models - see the OAuth presets in
/// agent-models.ts, which
/// replaces the catalog presets while it's the active OpenAI auth method).
/// Custom endpoints keep their configured model as the fallback, while these
/// two fields can optionally override it for writing and Agent independently.
function ProviderModelSection({
  t,
  kind,
}: {
  t: Strings;
  kind: "writing" | "agent";
}) {
  const { settings, setSettings } = useSettings();
  const provider = settings.aiProvider;
  const catalog = useProviderCatalog();
  const [fetched, setFetched] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Only relevant for "openai", which has two auth methods - the OAuth one
  // can't list models, so its preset list applies only while that's active.
  const [codexOauthActive, setCodexOauthActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (provider !== "openai") {
      setCodexOauthActive(false);
      return;
    }
    auth
      .oauthStatus("openai")
      .then((s) => {
        if (!cancelled) setCodexOauthActive(s.configured);
      })
      .catch(() => {
        if (!cancelled) setCodexOauthActive(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  useEffect(() => {
    setFetched([]);
    setError(null);
  }, [provider, kind]);

  const modelMap =
    kind === "agent" ? settings.agentModels : settings.writingModels;
  const current = modelMap[provider] ?? "";
  const setCurrent = useCallback(
    (value: string) => {
      if (kind === "agent") {
        setSettings({
          agentModels: { ...settings.agentModels, [provider]: value },
        });
      } else {
        setSettings({
          writingModels: { ...settings.writingModels, [provider]: value },
        });
      }
    },
    [kind, provider, setSettings, settings.agentModels, settings.writingModels],
  );
  const entry = catalog.find((e) => e.id === provider);

  // An API model id can be left behind when the user later enables Codex
  // OAuth. The OAuth backend only accepts its preset family; normalize an
  // incompatible saved choice to that mode's default instead of rendering a
  // blank select and sending a model the login cannot use.
  useEffect(() => {
    if (!codexOauthActive || provider !== "openai" || !current) return;
    const presets =
      kind === "agent"
        ? OPENAI_OAUTH_AGENT_MODEL_PRESETS
        : OPENAI_OAUTH_WRITING_MODEL_PRESETS;
    if (!presets.some((option) => option.value === current)) {
      setCurrent("");
    }
  }, [codexOauthActive, current, kind, provider, setCurrent]);

  async function fetchModels() {
    setLoading(true);
    setError(null);
    try {
      const list = await ai.fetchAgentModels(provider);
      setFetched(list);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const useCodexPresets = provider === "openai" && codexOauthActive;
  const canFetch =
    provider !== "custom" &&
    !useCodexPresets &&
    (entry?.modelsListable ?? true);
  const knownAndFetched = [
    ...(entry?.knownModels ?? []),
    ...fetched.filter((m) => !entry?.knownModels.includes(m)),
  ];
  if (current && !knownAndFetched.includes(current)) {
    knownAndFetched.push(current);
  }
  const defaultModel =
    kind === "agent" ? entry?.agentDefaultModel : entry?.defaultModel;
  const codexDefaultModel = kind === "agent" ? "gpt-5.6-sol" : "gpt-5.6-luna";
  const codexPresets =
    kind === "agent"
      ? OPENAI_OAUTH_AGENT_MODEL_PRESETS
      : OPENAI_OAUTH_WRITING_MODEL_PRESETS;
  const presetOptions: { value: string; label: string }[] = useCodexPresets
    ? codexPresets.map((option) => ({
        value: option.value,
        label: option.value || `${codexDefaultModel} (${t.modelDefault})`,
      }))
    : [
        ...(defaultModel
          ? [
              {
                value: "",
                label: `${defaultModel} (${t.modelDefault})`,
              },
            ]
          : []),
        ...knownAndFetched
          .filter((m) => m !== defaultModel)
          .map((m) => ({ value: m, label: m })),
      ];

  return (
    <div className="settings-field">
      <div>
        <div className="settings-row-label">
          {kind === "agent" ? t.agentModelLabel : t.writingModelLabel}
        </div>
        <div className="settings-row-hint">
          {kind === "agent" ? t.agentModelHint : t.writingModelHint}
        </div>
      </div>
      {error && <div className="settings-error">{error}</div>}
      <div className="custom-model-row">
        {presetOptions.length > 0 ? (
          <select
            className="settings-select"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          >
            {presetOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            className="settings-text-input"
            placeholder={t.customModelPlaceholder}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        )}
        {canFetch && (
          <button
            className="text-button settings-inline-button"
            onClick={fetchModels}
            disabled={loading}
          >
            {t.customFetchModels}
          </button>
        )}
      </div>
    </div>
  );
}

export function WritingModelSection({ t }: { t: Strings }) {
  return <ProviderModelSection t={t} kind="writing" />;
}

export function AgentModelSection({ t }: { t: Strings }) {
  return <ProviderModelSection t={t} kind="agent" />;
}

/// The agent workspace is configured through files, not settings controls -
/// this section just explains the .levis/ convention and opens the global
/// folder.
export function AgentWorkspaceSection({ t }: { t: Strings }) {
  const { settings } = useSettings();
  const [error, setError] = useState<string | null>(null);

  async function openFolder() {
    try {
      // Language picks the starter agent.md template on first use.
      await ai.openGlobalAgentDir(settings.language);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">{t.agentWorkspaceLabel}</div>
        <div className="settings-row-hint settings-workspace-hint">
          {t.agentWorkspaceHint}
        </div>
        {error && <div className="settings-error">{error}</div>}
      </div>
      <button
        className="text-button settings-inline-button"
        onClick={openFolder}
      >
        {t.agentWorkspaceOpenButton}
      </button>
    </div>
  );
}

/// The GLOBAL agent.md - the standing instructions in every chat's system
/// prompt. Levis IS a markdown editor, so the button just opens the file as
/// a document (creating an empty starter on first use) instead of embedding
/// a bespoke editor here. A document folder's .levis/agent.md layers on top
/// and stays file-managed.
export function AgentSystemPromptSection({
  t,
  onOpenFile,
  onClose,
}: {
  t: Strings;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}) {
  const { settings } = useSettings();
  const [error, setError] = useState<string | null>(null);

  async function editAgentMd() {
    try {
      // Language picks the starter agent.md template on first use.
      const path = await ai.ensureGlobalAgentMd(settings.language);
      onClose(); // the editor is behind the settings panel
      onOpenFile(path);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">{t.agentSystemPromptLabel}</div>
        <div className="settings-row-hint settings-workspace-hint">
          {t.agentSystemPromptHint}
        </div>
        {error && <div className="settings-error">{error}</div>}
      </div>
      <button
        className="text-button settings-inline-button"
        onClick={editAgentMd}
      >
        {t.agentSystemPromptEdit}
      </button>
    </div>
  );
}

/// The GLOBAL skill list, plus an import button that copies a .md skill
/// file into the global skills folder. Per-document .levis/skills still
/// layer on top when chatting - this section only manages the global set.
export function AgentSkillsSection({ t }: { t: Strings }) {
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [error, setError] = useState<string | null>(null);

  // docPath null = the global layer only, which is exactly what's editable here.
  useEffect(() => {
    ai.loadAgentWorkspace(null)
      .then((ws) => setSkills(ws?.skills ?? []))
      .catch(() => {});
  }, []);

  async function importSkill() {
    try {
      const updated = await ai.importAgentSkill();
      if (updated) setSkills(updated);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">{t.agentSkillsLabel}</div>
          <div className="settings-row-hint settings-workspace-hint">
            {t.agentSkillsHint}
          </div>
          {error && <div className="settings-error">{error}</div>}
        </div>
        <button
          className="text-button settings-inline-button"
          onClick={importSkill}
        >
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
              <span className="settings-skill-desc">
                {skill.description || skill.prompt}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
