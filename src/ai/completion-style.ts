import type { CompletionTone } from "../settings/SettingsContext";

/// Tone presets as English directives - the model instruction language is
/// English regardless of the UI language, matching the backend prompts.
const TONE_DIRECTIVES: Record<CompletionTone, string | null> = {
  default: null,
  formal: "Write in a formal, polished tone.",
  casual: "Write in a relaxed, conversational tone.",
  academic:
    "Write in a precise, academic tone appropriate for scholarly writing.",
  concise: "Be as concise as possible - prefer short, plain phrasing.",
};

/**
 * The user's completion tone preference as a directive string for the
 * backend to append to the completion prompt, or null when nothing is set.
 */
export function buildCompletionStyle(tone: CompletionTone): string | null {
  return TONE_DIRECTIVES[tone];
}
