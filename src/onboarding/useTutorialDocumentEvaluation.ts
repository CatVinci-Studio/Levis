import { useCallback } from "react";
import type { GrammarIssue } from "../ai/grammar-check-plugin";
import type { Strings } from "../i18n/strings";
import { useLatest } from "../utils/useLatest";
import {
  TUTORIAL_MOCK_GHOST_EVENT,
  TUTORIAL_MOCK_GRAMMAR_EVENT,
} from "../utils/events";
import {
  evaluateMarkdownTasks,
  type TutorialGrammarMock,
} from "./tutorial-evaluation";
import type { Tutorial } from "./useTutorial";

/**
 * Evaluates edits made in the isolated practice tab and advances the current
 * lesson. The callback remains stable for Milkdown's once-registered change
 * listener while latest-value refs keep language and tutorial state current.
 */
export function useTutorialDocumentEvaluation(tutorial: Tutorial, t: Strings) {
  const tutorialRef = useLatest(tutorial);
  const stringsRef = useLatest(t);

  return useCallback(
    (tabId: string, markdown: string) => {
      const current = tutorialRef.current;
      if (!current.active || tabId !== current.tabId) return;

      if (current.step.id === "markdownPractice") {
        // OR the detected bits in instead of overwriting: exercises skipped
        // via their checklist button live only in the phase, so a plain
        // assignment would clear them the next time the document changes.
        const bits = evaluateMarkdownTasks(markdown);
        current.setPhase((phase) => phase | bits);
        return;
      }

      if (current.step.id === "completion") {
        const {
          tutorialCompletionTarget: target,
          tutorialCompletionSuggestion: suggestion,
        } = stringsRef.current;
        if (markdown.includes(suggestion)) {
          if (current.phase < 2) current.setPhase(2);
        } else if (markdown.trimEnd().endsWith(target)) {
          if (current.phase < 1) current.setPhase(1);
          window.dispatchEvent(
            new CustomEvent(TUTORIAL_MOCK_GHOST_EVENT, { detail: suggestion }),
          );
        }
        return;
      }

      if (current.step.id === "agentEdit") {
        const {
          tutorialAgentEditTarget: target,
          tutorialAgentEditSuggestion: suggestion,
        } = stringsRef.current;
        if (markdown.includes(suggestion)) {
          if (current.phase < 3) current.setPhase(3);
        } else if (markdown.trimEnd().endsWith(target)) {
          if (current.phase < 1) current.setPhase(1);
        }
        return;
      }

      if (current.step.id !== "grammar") return;
      const {
        tutorialGrammarTarget: target,
        tutorialGrammarOriginal: original,
        tutorialGrammarIssue: issue,
        tutorialGrammarSuggestion: suggestion,
      } = stringsRef.current;
      const corrected = target.replace(original, suggestion);
      if (markdown.includes(corrected)) {
        if (current.phase < 2) current.setPhase(2);
      } else if (markdown.trimEnd().endsWith(target)) {
        if (current.phase < 1) current.setPhase(1);
        // Offsets are target-relative here, in Unicode scalars (the
        // decoration contract); the consumer re-bases them onto the cursor's
        // paragraph, which may hold text before the practice sentence (see
        // anchorGrammarIssues).
        const start = [...target.slice(0, target.indexOf(original))].length;
        const issues: GrammarIssue[] = [
          {
            start,
            end: start + [...original].length,
            issue,
            suggestion,
            original,
          },
        ];
        window.dispatchEvent(
          new CustomEvent(TUTORIAL_MOCK_GRAMMAR_EVENT, {
            detail: { target, issues } satisfies TutorialGrammarMock,
          }),
        );
      }
    },
    [stringsRef, tutorialRef],
  );
}
