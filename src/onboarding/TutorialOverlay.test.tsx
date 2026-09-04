// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TutorialOverlay } from "./TutorialOverlay";

afterEach(cleanup);

const labels = {
  collapse: "Minimize",
  expand: "Show instructions",
  back: "Back",
  skip: "Leave lesson",
  skipStep: "Skip this step",
  practice: "Try it",
  learned: "Skill unlocked",
  courseSections: "Course sections",
  skipItem: "Skip this exercise: {item}",
  stepOfCount: "Lesson {i} of {n}",
};

const sections = [
  { label: "Markdown basics", active: true, done: false },
  { label: "AI writing", active: false, done: false },
];

describe("TutorialOverlay", () => {
  it("labels and focuses a reading lesson as an accessible dialog", () => {
    render(
      <TutorialOverlay
        layout="overlay"
        stepId="welcome"
        stepIndex={0}
        totalSteps={9}
        sections={sections}
        title="Learn by making"
        body="A short hands-on lesson."
        primaryLabel="Start learning"
        onPrimary={vi.fn()}
        onBack={vi.fn()}
        onSkip={vi.fn()}
        labels={labels}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Learn by making" }),
    ).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByRole("button", { name: /start learning/i }),
    ).toHaveFocus();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
  });

  it("keeps Continue disabled until a practice lesson is complete", () => {
    const onPrimary = vi.fn();
    const onSkipStep = vi.fn();
    render(
      <TutorialOverlay
        layout="card"
        stepId="markdownPractice"
        stepIndex={2}
        totalSteps={9}
        sections={sections}
        title="Markdown"
        body="Give the page structure."
        checklist={[{ label: "Type a heading", done: false }]}
        status="Type a heading"
        waiting
        primaryLabel="Continue"
        primaryDisabled
        onPrimary={onPrimary}
        onBack={vi.fn()}
        onSkip={vi.fn()}
        onSkipStep={onSkipStep}
        labels={labels}
      />,
    );

    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(continueButton).toBeDisabled();
    fireEvent.click(continueButton);
    expect(onPrimary).not.toHaveBeenCalled();

    // The per-lesson escape hatch: a misfiring exercise must never leave
    // "exit the whole guide" as the only way forward.
    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    expect(onSkipStep).toHaveBeenCalledOnce();
  });

  it("lets the learner skip a checklist exercise by clicking its number", () => {
    const onSkip = vi.fn();
    render(
      <TutorialOverlay
        layout="card"
        stepId="markdownPractice"
        stepIndex={2}
        totalSteps={9}
        sections={sections}
        title="Markdown"
        body="Try the syntax."
        checklist={[
          { label: "Type a heading", done: false, onSkip },
          { label: "Type bold text", done: false, onSkip: vi.fn() },
        ]}
        primaryLabel="Continue"
        onPrimary={vi.fn()}
        onBack={vi.fn()}
        onSkip={vi.fn()}
        labels={labels}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Skip this exercise: Type a heading",
      }),
    );
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("does not exit the whole guide when Escape is pressed", () => {
    const onSkip = vi.fn();
    render(
      <TutorialOverlay
        layout="card"
        stepId="agentChat"
        stepIndex={6}
        totalSteps={9}
        sections={sections}
        title="Chat"
        body="Ask a question."
        primaryLabel="Continue"
        onPrimary={vi.fn()}
        onBack={vi.fn()}
        onSkip={onSkip}
        labels={labels}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onSkip).not.toHaveBeenCalled();
  });
  it("can minimize a practice without disabling navigation or editing", () => {
    render(
      <TutorialOverlay
        layout="card"
        stepId="completion"
        stepIndex={4}
        totalSteps={9}
        sections={sections}
        title="Completion"
        body="Type the sample."
        task="Sample text"
        primaryLabel="Continue"
        onPrimary={vi.fn()}
        onBack={vi.fn()}
        onSkip={vi.fn()}
        labels={labels}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(screen.getByText("Sample text")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Continue" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show instructions" }));
    expect(screen.getByText("Sample text")).toBeVisible();
  });

  it("keeps Tab inside reading lessons and closes them with Escape", () => {
    const onSkip = vi.fn();
    render(
      <TutorialOverlay
        layout="overlay"
        stepId="welcome"
        stepIndex={0}
        totalSteps={9}
        sections={sections}
        title="Welcome"
        body="Read the introduction."
        primaryLabel="Start"
        onPrimary={vi.fn()}
        onBack={vi.fn()}
        onSkip={onSkip}
        labels={labels}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Start" }), {
      key: "Tab",
    });
    expect(screen.getByRole("button", { name: "Leave lesson" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
