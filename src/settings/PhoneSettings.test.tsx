// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./SettingsContext", () => ({
  useSettings: () => ({
    t: { settingsTitle: "Settings", settingsDone: "Done" },
  }),
}));
afterEach(cleanup);

const { PhoneSettings } = await import("./PhoneSettings");

function renderSettings(onClose = vi.fn()) {
  render(
    <PhoneSettings
      categories={[
        { id: "general", label: "General" },
        { id: "privacy", label: "Privacy" },
      ]}
      renderCategory={(c) => <p>rows of {c}</p>}
      onClose={onClose}
    />,
  );
  return onClose;
}

describe("PhoneSettings", () => {
  it("pushes a category's page and comes back to the list", () => {
    renderSettings();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Privacy" }));
    expect(screen.getByRole("heading", { name: "Privacy" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Privacy" })).toHaveTextContent(
      "rows of privacy",
    );
    // The back button is named after where it leads, and has the focus.
    const back = screen.getByRole("button", { name: "Settings" });
    expect(back).toHaveFocus();
    fireEvent.click(back);
    expect(screen.queryByRole("region")).toBeNull();
    // Focus returns to the row the page was opened from.
    expect(screen.getByRole("button", { name: "Privacy" })).toHaveFocus();
  });

  it("Escape steps back a page before it closes", () => {
    const onClose = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Done closes from a pushed page", () => {
    const onClose = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });
});
