import { normalizeMathDelimiters } from "../../utils/markdown-math";
import {
  EDIT_ACTIONS,
  type AgentSkill,
  type EditAction,
  type EditProposal,
} from "../types";

/**
 * A propose_edit tool call's arguments as a validated EditProposal, or null
 * if they don't parse or are missing what their action requires (same rules
 * the backend tool validates against).
 */
export function parseProposal(argumentsJson: string): EditProposal | null {
  try {
    const parsed = JSON.parse(argumentsJson);
    const action = parsed.action as EditAction;
    if (!EDIT_ACTIONS.includes(action)) return null;
    const anchor =
      typeof parsed.anchor === "string" && parsed.anchor
        ? parsed.anchor
        : undefined;
    // Only the inserted text, never the anchor - the anchor must stay a
    // verbatim quote of the document to match.
    const text =
      typeof parsed.text === "string"
        ? normalizeMathDelimiters(parsed.text)
        : undefined;
    if (action !== "append" && action !== "replace_selection" && !anchor)
      return null;
    if (action !== "delete" && text === undefined) return null;
    return { action, anchor, text };
  } catch {
    return null;
  }
}

/**
 * Resolves a leading /name skill invocation: the skill's prompt becomes the
 * message body, with whatever followed the name appended as extra input.
 * A slash token that doesn't name a skill is left alone - it might just be
 * text that starts with a slash.
 */
export function resolveSkillMessage(
  message: string,
  skills: AgentSkill[],
): string {
  const m = /^\/(\S+)\s*([\s\S]*)$/.exec(message);
  if (!m) return message;
  const skill = skills.find((s) => s.name === m[1]);
  if (!skill) return message;
  return m[2] ? `${skill.prompt}\n\n${m[2]}` : skill.prompt;
}
