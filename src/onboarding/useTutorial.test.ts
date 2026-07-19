// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useTutorial } from "./useTutorial";
import { installTestLocalStorage } from "../test-local-storage";

describe("useTutorial navigation", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  it("keeps a lesson complete when the learner moves back and forth", () => {
    const { result } = renderHook(() => useTutorial());

    act(() => result.current.start("practice-tab"));
    act(() => result.current.next()); // Markdown chapter transition
    act(() => result.current.next()); // Markdown exercise
    act(() => result.current.setPhase(127));
    expect(result.current.step.id).toBe("markdownPractice");
    expect(result.current.phase).toBe(127);

    act(() => result.current.next()); // AI chapter transition
    act(() => result.current.back());
    expect(result.current.step.id).toBe("markdownPractice");
    expect(result.current.phase).toBe(127);
  });
});
