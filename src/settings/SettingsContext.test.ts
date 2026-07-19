// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadSettings } from "./SettingsContext";
import { installTestLocalStorage } from "../test-local-storage";

const SETTINGS_KEY = "catvinci-settings";

describe("newcomer guide eligibility", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  it("marks a brand-new installation as needing onboarding", () => {
    expect(loadSettings().onboardingShown).toBe(false);
  });

  it("does not surprise installations whose old settings predate the flag", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: "zh" }));
    expect(loadSettings().onboardingShown).toBe(true);
  });

  it("preserves a deferred first-use guide until it is actually shown", () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ language: "zh", onboardingShown: false }),
    );
    expect(loadSettings().onboardingShown).toBe(false);
  });
});

describe("separate writing and Agent models", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  it("starts both per-provider model maps empty so each backend default applies", () => {
    const settings = loadSettings();
    expect(settings.writingModels).toEqual({});
    expect(settings.agentModels).toEqual({});
  });

  it("preserves writing and Agent choices independently", () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        writingModels: { openai: "gpt-5.4-nano" },
        agentModels: { openai: "gpt-5.6" },
      }),
    );
    const settings = loadSettings();
    expect(settings.writingModels.openai).toBe("gpt-5.4-nano");
    expect(settings.agentModels.openai).toBe("gpt-5.6");
  });
});
