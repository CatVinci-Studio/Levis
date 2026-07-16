import { useCallback, useEffect, useState } from "react";
import { TUTORIAL_STEPS } from "./tutorial-steps";

const STORAGE_KEY = "levis-tutorial-progress";

interface TutorialProgress {
  active: boolean;
  stepIndex: number;
}

function loadProgress(): TutorialProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { active: false, stepIndex: 0 };
    const parsed = JSON.parse(raw);
    const stepIndex = Math.min(Math.max(0, Number(parsed.stepIndex) || 0), TUTORIAL_STEPS.length - 1);
    return { active: !!parsed.active, stepIndex };
  } catch {
    return { active: false, stepIndex: 0 };
  }
}

/**
 * The step-by-step tutorial's state machine: which step is showing, and
 * whether it's active at all. Persisted to localStorage (not just React
 * state) so closing the app mid-tutorial resumes at the same step on
 * relaunch instead of silently losing progress or restarting from zero.
 */
export function useTutorial() {
  const [progress, setProgress] = useState<TutorialProgress>(loadProgress);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // Storage unavailable - the tutorial still works for this session,
      // it just won't resume after a restart.
    }
  }, [progress]);

  const start = useCallback(() => setProgress({ active: true, stepIndex: 0 }), []);

  const next = useCallback(() => {
    setProgress((p) => {
      if (p.stepIndex + 1 >= TUTORIAL_STEPS.length) return { active: false, stepIndex: 0 };
      return { active: true, stepIndex: p.stepIndex + 1 };
    });
  }, []);

  const back = useCallback(() => {
    setProgress((p) => ({ ...p, stepIndex: Math.max(0, p.stepIndex - 1) }));
  }, []);

  const exit = useCallback(() => setProgress({ active: false, stepIndex: 0 }), []);

  return {
    active: progress.active,
    stepIndex: progress.stepIndex,
    step: TUTORIAL_STEPS[progress.stepIndex],
    totalSteps: TUTORIAL_STEPS.length,
    start,
    next,
    back,
    skip: exit,
    exit,
  };
}

export type Tutorial = ReturnType<typeof useTutorial>;
