import type { Strings } from "../i18n/strings";

export type TutorialSectionId = "markdown" | "ai";

export type TutorialStepId =
  | "welcome"
  | "markdownIntro"
  | "markdownPractice"
  | "aiIntro"
  | "completion"
  | "grammar"
  | "agentChat"
  | "agentEdit"
  | "done";

export interface TutorialSection {
  id: TutorialSectionId;
  titleKey: keyof Strings;
}

export interface TutorialStep {
  id: TutorialStepId;
  /** Opening and ending frame the two chapters rather than belonging to one. */
  section: TutorialSectionId | null;
  layout: "overlay" | "card";
  titleKey: keyof Strings;
  bodyKey: keyof Strings;
}

/**
 * The first-run experience has two visible chapters. Each entry in
 * TUTORIAL_STEPS is one independently navigable lesson card inside a
 * chapter; reading lessons use a focused overlay while exercises keep the
 * editor interactive underneath.
 */
export const TUTORIAL_SECTIONS: TutorialSection[] = [
  { id: "markdown", titleKey: "tutorialSectionMarkdown" },
  { id: "ai", titleKey: "tutorialSectionAi" },
];

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    section: null,
    layout: "overlay",
    titleKey: "tutorialWelcomeTitle",
    bodyKey: "tutorialWelcomeBody",
  },
  {
    id: "markdownIntro",
    section: "markdown",
    layout: "overlay",
    titleKey: "tutorialMarkdownIntroTitle",
    bodyKey: "tutorialMarkdownIntroBody",
  },
  {
    id: "markdownPractice",
    section: "markdown",
    layout: "card",
    titleKey: "tutorialMarkdownPracticeTitle",
    bodyKey: "tutorialMarkdownPracticeBody",
  },
  {
    id: "aiIntro",
    section: "ai",
    layout: "overlay",
    titleKey: "tutorialAiIntroTitle",
    bodyKey: "tutorialAiIntroBody",
  },
  {
    id: "completion",
    section: "ai",
    layout: "card",
    titleKey: "tutorialCompletionTitle",
    bodyKey: "tutorialCompletionBody",
  },
  {
    id: "grammar",
    section: "ai",
    layout: "card",
    titleKey: "tutorialGrammarTitle",
    bodyKey: "tutorialGrammarBody",
  },
  {
    id: "agentChat",
    section: "ai",
    layout: "card",
    titleKey: "tutorialAgentChatTitle",
    bodyKey: "tutorialAgentChatBody",
  },
  {
    id: "agentEdit",
    section: "ai",
    layout: "card",
    titleKey: "tutorialAgentEditTitle",
    bodyKey: "tutorialAgentEditBody",
  },
  {
    id: "done",
    section: null,
    layout: "overlay",
    titleKey: "tutorialDoneTitle",
    bodyKey: "tutorialDoneBody",
  },
];
