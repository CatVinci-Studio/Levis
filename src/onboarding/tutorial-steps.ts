import type { Strings } from "../i18n/strings";

export type TutorialStepId = "welcome" | "markdown" | "completion" | "askAi" | "editPreview" | "shortcuts";

export interface TutorialStep {
  id: TutorialStepId;
  titleKey: keyof Strings;
  bodyKey: keyof Strings;
}

/**
 * The tutorial's steps, in order - a fixed script paired with the welcome
 * doc (src/help/welcome.{en,zh,ja}.md), which is where the actual
 * interactive practice happens. This card just narrates: what to look for,
 * what to try. Advance is manual only (Next/Back/Skip) - there's no
 * detector wired to any of these steps, keeping the tutorial predictable
 * rather than occasionally getting stuck waiting for an action it
 * misdetected.
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  { id: "welcome", titleKey: "tutorialWelcomeTitle", bodyKey: "tutorialWelcomeBody" },
  { id: "markdown", titleKey: "tutorialMarkdownTitle", bodyKey: "tutorialMarkdownBody" },
  { id: "completion", titleKey: "tutorialCompletionTitle", bodyKey: "tutorialCompletionBody" },
  { id: "askAi", titleKey: "tutorialAskAiTitle", bodyKey: "tutorialAskAiBody" },
  { id: "editPreview", titleKey: "tutorialEditPreviewTitle", bodyKey: "tutorialEditPreviewBody" },
  { id: "shortcuts", titleKey: "tutorialShortcutsTitle", bodyKey: "tutorialShortcutsBody" },
];
