import type { Strings } from "../i18n/strings";
import type { MockAgentReply } from "../ai/useAgentConversation";

/**
 * Builds the provider-free Agent used only by the newcomer guide. Keeping
 * this script next to the course configuration makes the two exercises
 * explicit: ordinary questions return prose, while the editing request
 * returns the same propose_edit tool call a real provider would use.
 */
/// Punctuation-, whitespace-, and case-insensitive containment. Learners
/// retype the displayed prompt by hand - the zh prompt's curly quotes, a
/// trailing period, or capitalization must not derail the exercise.
function normalize(text: string): string {
  return text.replace(/[\p{P}\p{S}\s]+/gu, "").toLowerCase();
}

export function createTutorialMockAgent(t: Strings): MockAgentReply {
  return (message) => {
    if (!normalize(message).includes(normalize(t.tutorialAgentEditPrompt)))
      return t.tutorialAgentChatMockReply;

    return [
      {
        kind: "ToolCall",
        call_id: crypto.randomUUID(),
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: t.tutorialAgentEditTarget,
          text: t.tutorialAgentEditSuggestion,
        }),
      },
      {
        kind: "Assistant",
        text: t.tutorialAgentEditMockReply,
      },
    ];
  };
}
