import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../SettingsContext";
import type { Strings } from "../../i18n/strings";
import type { AgentSkill } from "../../ai/types";
import { CODEX_MODEL_PRESETS } from "../agent-models";

// The Agent category's sections. The agent workspace itself is file-managed
// (the .levis/ convention) - these sections mostly open folders/files rather
// than embedding editors; the full write-up lives in Help > AI Agent Guide.

/// Model picker for the agent chat, for whichever provider is active in the
/// AI tab. Codex gets a hardcoded preset list (its OAuth token can't list
/// models - see agent-models.ts); claude/apikey fetch live. "custom" already
/// has its own in CustomProviderPanel.
export function AgentModelSection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const provider = settings.aiProvider;
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (provider === "custom") return null;

  const key = `${provider}AgentModel` as const;
  const current = settings[key];

  async function fetchModels() {
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<string[]>("fetch_agent_models", { provider });
      setModels(list);
      if (!current && list.length > 0) setSettings({ [key]: list[0] } as Partial<typeof settings>);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const presetOptions = provider === "codex" ? CODEX_MODEL_PRESETS : models.map((m) => ({ value: m, label: m }));

  return (
    <div className="settings-field">
      <div>
        <div className="settings-section-label">{t.agentModelLabel}</div>
        <div className="settings-row-hint">{t.agentModelHint}</div>
      </div>
      {error && <div className="settings-error">{error}</div>}
      <div className="custom-model-row">
        {presetOptions.length > 0 ? (
          <select value={current} onChange={(e) => setSettings({ [key]: e.target.value } as Partial<typeof settings>)}>
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
            onChange={(e) => setSettings({ [key]: e.target.value } as Partial<typeof settings>)}
          />
        )}
        {provider !== "codex" && (
          <button className="text-button settings-inline-button" onClick={fetchModels} disabled={loading}>
            {t.customFetchModels}
          </button>
        )}
      </div>
    </div>
  );
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
export function AgentSkillsSection({ t }: { t: Strings }) {
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
