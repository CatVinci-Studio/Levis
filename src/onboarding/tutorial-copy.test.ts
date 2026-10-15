// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LANGS, resolveStrings } from "../i18n/strings";
import { installTestLocalStorage } from "../test-local-storage";
import { useTutorial } from "./useTutorial";
import { useTutorialDocumentEvaluation } from "./useTutorialDocumentEvaluation";
import { TUTORIAL_STEPS } from "./tutorial-steps";
beforeAll(installTestLocalStorage);
beforeEach(() => localStorage.clear());
afterEach(cleanup);
describe("localized editing exercises", () => {
  it.each(LANGS)(
    "recognizes the displayed source and revision in %s",
    (lang) => {
      localStorage.setItem(
        "levis-tutorial-progress",
        JSON.stringify({
          active: true,
          stepIndex: TUTORIAL_STEPS.findIndex((s) => s.id === "agentEdit"),
          tabId: "practice",
        }),
      );
      const copy = resolveStrings(lang);
      const { result } = renderHook(() => {
        const tutorial = useTutorial();
        const evaluate = useTutorialDocumentEvaluation(tutorial, copy);
        return { tutorial, evaluate };
      });
      act(() =>
        result.current.evaluate(
          "another-document",
          copy.tutorialAgentEditTarget,
        ),
      );
      expect(result.current.tutorial.phase).toBe(0);
      act(() =>
        result.current.evaluate("practice", copy.tutorialAgentEditTarget),
      );
      expect(result.current.tutorial.phase).toBe(1);
      act(() =>
        result.current.evaluate("practice", copy.tutorialAgentEditSuggestion),
      );
      expect(result.current.tutorial.phase).toBe(3);
    },
  );
});
