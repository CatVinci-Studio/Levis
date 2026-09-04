// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strings } from "../../i18n/strings";
import { ThemeSection } from "./theme";
import { fs, themes } from "../../ipc";
const mock = vi.hoisted(() => ({
  setSettings: vi.fn(),
  settings: {
    theme: "system",
    themeId: "user-test",
    userThemes: [{ id: "user-test", name: "Test", hasDark: false }],
  },
}));
vi.mock("../SettingsContext", () => ({
  useSettings: () => mock,
  THEME_MODES: ["system", "light", "dark"],
  BUILTIN_CONTENT_THEMES: [{ id: "default", nameKey: "themeNameDefault" }],
}));
vi.mock("../../ipc", () => ({
  fs: { openCssFileDialog: vi.fn() },
  themes: { deleteTheme: vi.fn(), saveThemeCss: vi.fn() },
}));
vi.mock("../../utils/theme-import", () => ({
  importThemeCss: vi.fn().mockResolvedValue("body{}"),
}));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
describe("theme settings", () => {
  it("offers named appearance choices with the current selection", () => {
    render(<ThemeSection t={strings.en} />);
    expect(screen.getByRole("radio", { name: "Follow system" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(mock.setSettings).toHaveBeenCalledWith({ theme: "dark" });
  });
  it("shows picker errors and allows retry", async () => {
    vi.mocked(fs.openCssFileDialog).mockRejectedValueOnce(
      new Error("Cannot open picker"),
    );
    render(<ThemeSection t={strings.en} />);
    fireEvent.click(
      screen.getByRole("button", { name: strings.en.themeImportButton }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cannot open picker",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: strings.en.themeImportButton }),
      ).toBeEnabled(),
    );
  });
  it("keeps the selected theme after deletion fails", async () => {
    vi.mocked(themes.deleteTheme).mockRejectedValueOnce(
      new Error("Read-only folder"),
    );
    render(<ThemeSection t={strings.en} />);
    fireEvent.click(
      screen.getByRole("button", { name: strings.en.themeDeleteButton }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Read-only folder",
    );
    expect(mock.setSettings).not.toHaveBeenCalled();
  });
});
