// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageWelcome } from "./LanguageWelcome";
afterEach(cleanup);
describe("first-run language choice", () => {
  it("starts on Continue and keeps Tab within the language dialog", () => {
    render(
      <LanguageWelcome
        language="zh"
        onLanguage={vi.fn()}
        onContinue={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /继续/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(screen.getByRole("button", { name: /中文/ })).toHaveFocus();
  });
  it("does not advance while changing language or cancelling IME input", () => {
    const onLanguage = vi.fn();
    const onContinue = vi.fn();
    render(
      <LanguageWelcome
        language="zh"
        onLanguage={onLanguage}
        onContinue={onContinue}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /English/ }));
    expect(onLanguage).toHaveBeenCalledWith("en");
    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Escape",
      isComposing: true,
    });
    expect(onContinue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /继续/ }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
