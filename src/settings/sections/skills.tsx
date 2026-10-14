import { useCallback, useEffect, useState } from "react";
import { errorText } from "../../utils/error-text";
import { useSettings } from "../SettingsContext";
import type { Strings, TextKey } from "../../i18n/strings";
import { skillText } from "../../i18n/skills";
import {
  BUILTIN_SKILLS,
  SKILL_CATEGORIES,
  isBuiltinSkillName,
  type SkillCategory,
} from "../../ai/skills/builtin";
import type { AgentSkill } from "../../ai/types";
import { ai, type SkillListItem } from "../../ipc";
import { showConfirm } from "../../ui/app-dialog";
import { Select } from "../../ui/Select";
import { SettingRow } from "./controls";
import {
  AUTOMATIC_CONVENTIONS,
  CONVENTION_PROFILES,
  conventionsLanguageName,
  conventionsProfileName,
} from "../writing-conventions";

// Settings > Levis AI: skills (the user's own, and the built-ins with their
// switches, Customize… and Reset) and the Writing conventions row. Skills
// are files: the rows here mirror them and open them in a tab, they never
// embed an editor.

/** Fired after a skill changes here, so every section showing the list
 *  reloads it. */
const SKILLS_CHANGED_EVENT = "levis-skills-changed";

function announceChange() {
  window.dispatchEvent(new Event(SKILLS_CHANGED_EVENT));
}

/** The skill list as Settings shows it: the built-ins and the global
 *  layer (no document, so no project). `list` is null where the backend
 *  has no list (then only the global skills are known). */
function useSkillList() {
  const [list, setList] = useState<SkillListItem[] | null>(null);
  const [workspaceSkills, setWorkspaceSkills] = useState<AgentSkill[]>([]);

  const reload = useCallback(() => {
    ai.listSkills(null, null)
      .then((items) => setList(Array.isArray(items) ? items : null))
      .catch(() => setList(null));
    // Both null = the global layer only, which is exactly what's editable.
    ai.loadAgentWorkspace(null, null)
      .then((ws) => setWorkspaceSkills(ws?.skills ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener(SKILLS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(SKILLS_CHANGED_EVENT, reload);
  }, [reload]);

  return { list, setList, workspaceSkills, setWorkspaceSkills };
}

/// The Skills row - how to use one, and Import Skill… - and the user's own
/// skills under it. A skill with a built-in's name says it replaces it.
export function AgentSkillsSection({ t }: { t: Strings }) {
  const { list, workspaceSkills, setWorkspaceSkills } = useSkillList();
  const [error, setError] = useState<string | null>(null);

  async function importSkill() {
    try {
      const updated = await ai.importAgentSkill();
      if (updated) setWorkspaceSkills(updated);
      setError(null);
      announceChange();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const own: {
    name: string;
    description: string;
    source: SkillListItem["source"];
    shadows: boolean;
  }[] = list
    ? list
        .filter((item) => item.source !== "builtin")
        .map((item) => ({
          name: item.name,
          description: item.description,
          source: item.source,
          shadows: item.overridesBuiltin,
        }))
    : workspaceSkills.map((skill) => ({
        name: skill.name,
        description: skill.description || skill.prompt,
        source: "global",
        shadows: isBuiltinSkillName(skill.name),
      }));

  return (
    <>
      <SettingRow
        label={t.agentSkillsLabel}
        hint={t.agentSkillsHint}
        error={error}
      >
        <button
          className="text-button settings-inline-button"
          onClick={importSkill}
        >
          {t.agentSkillsImport}
        </button>
      </SettingRow>
      {own.length > 0 && (
        <div className="settings-skill-list">
          {own.map((skill) => (
            <div key={skill.name} className="settings-skill-item">
              <span className="settings-skill-name">/{skill.name}</span>
              {(skill.shadows || skill.source === "project") && (
                <span className="settings-skill-tag">
                  {skill.shadows ? t.agentSkillsShadows : t.skillGroupProject}
                </span>
              )}
              <span className="settings-skill-desc">{skill.description}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const CATEGORY_LABEL: Record<SkillCategory, TextKey> = {
  write: "skillCategoryWrite",
  revise: "skillCategoryRevise",
  check: "skillCategoryCheck",
  format: "skillCategoryFormat",
};

/// The built-in skills, by category, behind a disclosure: each one's label
/// and what it does, a switch, and Customize… - which copies it into the
/// global config folder's skills/ and opens the copy in a tab. A customized
/// one opens its copy instead, and Reset deletes the copy.
export function BuiltinSkillsSection({
  t,
  onOpenFile,
  onClose,
}: {
  t: Strings;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}) {
  const { settings } = useSettings();
  const lang = settings.language;
  const { list, setList } = useSkillList();
  const [error, setError] = useState<string | null>(null);

  const builtinItem = (name: string) =>
    list?.find((item) => item.name === name && item.source === "builtin");
  const override = (name: string) =>
    list?.find((item) => item.name === name && item.source !== "builtin");
  const enabled = (name: string) =>
    builtinItem(name)?.enabled ?? override(name)?.enabled ?? true;
  const onCount = BUILTIN_SKILLS.filter((s) => enabled(s.name)).length;

  async function setEnabled(name: string, on: boolean) {
    setError(null);
    const before = list;
    // At once on screen; put back if the backend says no.
    setList(
      (list ?? []).map((item) =>
        item.name === name && item.source === "builtin"
          ? { ...item, enabled: on }
          : item,
      ),
    );
    try {
      await ai.setBuiltinSkillEnabled(name, on);
      announceChange();
    } catch (err) {
      setList(before);
      setError(errorText(err));
    }
  }

  async function openCopy(name: string) {
    setError(null);
    try {
      const path = await ai.customizeBuiltinSkill(name);
      announceChange();
      onClose(); // the editor is behind the settings panel
      onOpenFile(path);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function reset(name: string, label: string) {
    setError(null);
    const ok = await showConfirm(
      t.agentSkillsResetConfirm.replace("{name}", label),
      { okLabel: t.agentSkillsReset, cancelLabel: t.cancel, danger: true },
    );
    if (!ok) return;
    try {
      await ai.resetBuiltinSkill(name);
      announceChange();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <details className="settings-advanced settings-builtin-skills">
      <summary>
        <span className="settings-builtin-skills-title">
          {t.agentSkillsBuiltin}
        </span>
        <span className="settings-builtin-skills-count">
          {t.agentSkillsOnCount
            .replace("{n}", String(onCount))
            .replace("{total}", String(BUILTIN_SKILLS.length))}
        </span>
      </summary>
      <div className="settings-advanced-body">
        {error && (
          <div className="settings-error" role="alert">
            {error}
          </div>
        )}
        {SKILL_CATEGORIES.map((category) => (
          <div
            key={category}
            className="settings-builtin-category"
            role="group"
            aria-label={t[CATEGORY_LABEL[category]]}
          >
            <div className="settings-builtin-category-title" aria-hidden="true">
              {t[CATEGORY_LABEL[category]]}
            </div>
            {BUILTIN_SKILLS.filter((s) => s.category === category).map(
              ({ name }) => {
                const text = skillText(lang, name);
                const customized = !!override(name);
                const on = enabled(name);
                return (
                  <div
                    key={name}
                    className="settings-row settings-builtin-skill"
                    data-skill={name}
                    data-enabled={on}
                  >
                    <div className="settings-row-text">
                      <div className="settings-row-label">
                        {text.label}
                        {customized && (
                          <span className="settings-skill-tag">
                            {t.agentSkillsCustomized}
                          </span>
                        )}
                      </div>
                      <div className="settings-row-hint">
                        <span className="settings-builtin-skill-name">
                          /{name}
                        </span>
                        {" · "}
                        {text.hint}
                      </div>
                    </div>
                    <div className="settings-row-control">
                      <span className="settings-skill-actions">
                        {customized ? (
                          <>
                            <button
                              className="settings-skill-action"
                              aria-label={`${t.agentSkillsOpen}: ${text.label}`}
                              onClick={() => openCopy(name)}
                            >
                              {t.agentSkillsOpen}
                            </button>
                            <button
                              className="settings-skill-action"
                              aria-label={`${t.agentSkillsReset}: ${text.label}`}
                              onClick={() => reset(name, text.label)}
                            >
                              {t.agentSkillsReset}
                            </button>
                          </>
                        ) : (
                          <button
                            className="settings-skill-action"
                            aria-label={`${t.agentSkillsCustomize}: ${text.label}`}
                            onClick={() => openCopy(name)}
                          >
                            {t.agentSkillsCustomize}
                          </button>
                        )}
                      </span>
                      <input
                        type="checkbox"
                        aria-label={text.label}
                        checked={on}
                        onChange={(e) => setEnabled(name, e.target.checked)}
                      />
                    </div>
                  </div>
                );
              },
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

/// Writing conventions: Automatic, or one profile - grouped by the
/// document language it is for.
export function WritingConventionsRow({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const lang = settings.language;
  const value = settings.writingConventions;
  const known =
    value === AUTOMATIC_CONVENTIONS ||
    CONVENTION_PROFILES.some((g) => g.profiles.includes(value));
  return (
    <SettingRow label={t.writingConventionsLabel}>
      <Select
        className="settings-select"
        aria-label={t.writingConventionsLabel}
        value={value}
        onChange={(e) => setSettings({ writingConventions: e.target.value })}
      >
        <option value={AUTOMATIC_CONVENTIONS}>
          {t.writingConventionsAuto}
        </option>
        {/* A newer build's profile stays selectable, by its own name. */}
        {!known && <option value={value}>{value}</option>}
        {CONVENTION_PROFILES.map((group) => (
          <optgroup
            key={group.language}
            label={conventionsLanguageName(lang, group.language)}
          >
            {group.profiles.map((profile) => (
              <option key={profile} value={profile}>
                {conventionsProfileName(t, lang, profile)}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </SettingRow>
  );
}
