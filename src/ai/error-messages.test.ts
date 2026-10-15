import { describe, expect, it } from "vitest";
import { classifyAiError } from "./error-messages";

describe("classifyAiError", () => {
  it.each([
    ["Claude request failed (401 Unauthorized): invalid x-api-key", "auth"],
    ["This API key is not scoped to a workspace, so ...", "workspaceKey"],
    ["Could not list models (429 Too Many Requests)", "rateLimit"],
    ["Claude request failed (529): overloaded_error", "rateLimit"],
    ["request failed (503 Service Unavailable)", "server"],
    ["error sending request for url (https://api...)", "network"],
    ["operation timed out", "timeout"],
    [
      "This provider isn't set up yet - configure it in Settings > Textus AI.",
      "notConfigured",
    ],
    [
      "The 'gpt-x' model is not supported when using Codex with a ChatGPT account",
      "model",
    ],
  ])("%s -> %s", (text, kind) => {
    expect(classifyAiError(text)).toBe(kind);
  });
  it("leaves unknown errors alone", () => {
    expect(classifyAiError("something odd")).toBeNull();
  });
});
