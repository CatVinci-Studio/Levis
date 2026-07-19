// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { strings } from "../../i18n/strings";
import type { ProviderCatalogEntry } from "../../ai/provider-catalog";
import { ProviderAuthPanel, ProviderListPanel } from "./providers";

const settingsMocks = vi.hoisted(() => ({ setSettings: vi.fn() }));
const providerMocks = vi.hoisted(() => ({
  catalog: [
    {
      id: "google",
      label: "Google Gemini",
      dialect: "openai-chat-completions",
      auth: ["api_key"],
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      defaultModel: "gemini-3.1-flash-lite",
      agentDefaultModel: "gemini-3.5-flash",
      keyOptional: false,
      modelsListable: true,
      knownModels: ["gemini-3.5-flash"],
    },
  ],
}));

vi.mock("../SettingsContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../SettingsContext")>()),
  useSettings: () => ({
    settings: { aiProvider: "google" },
    setSettings: settingsMocks.setSettings,
  }),
}));

vi.mock("../../ai/provider-catalog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../ai/provider-catalog")>();
  return { ...actual, useProviderCatalog: () => providerMocks.catalog };
});

vi.mock("../../ipc", () => ({
  auth: {
    providerApiKeyStatus: vi.fn().mockResolvedValue(false),
    setProviderApiKey: vi.fn().mockResolvedValue(undefined),
    clearProviderApiKey: vi.fn().mockResolvedValue(undefined),
    oauthStatus: vi.fn().mockResolvedValue({ configured: false }),
    oauthLogin: vi.fn(),
    oauthLogout: vi.fn(),
  },
}));

const google = providerMocks.catalog[0] as ProviderCatalogEntry;

afterEach(cleanup);

describe("ProviderAuthPanel", () => {
  it("shows the API key form for providers that do not offer account login", () => {
    render(
      <ProviderAuthPanel
        t={strings.en}
        entry={google}
        onStatusChange={() => {}}
      />,
    );

    expect(screen.getByPlaceholderText("sk-…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /sign in/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps credentials collapsed behind a second compact disclosure row", () => {
    render(<ProviderListPanel t={strings.en} />);

    expect(
      screen.getByRole("button", { name: /Provider: Google Gemini/i }),
    ).toBeInTheDocument();
    const credentials = screen.getByRole("button", {
      name: /Login & credentials: Not configured/i,
    });
    expect(screen.queryByPlaceholderText("sk-…")).not.toBeInTheDocument();

    fireEvent.click(credentials);
    expect(screen.getByPlaceholderText("sk-…")).toBeInTheDocument();
  });
});
