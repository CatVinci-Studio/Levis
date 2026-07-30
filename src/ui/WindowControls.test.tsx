// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The caption is the only way to close a window that has no OS frame, and it
 * must be absent on the platform that still has one - so both halves of the
 * gate are worth pinning down. A regression either way is invisible in
 * review and total in use: a stranded window on Windows, or a second set of
 * buttons next to the traffic lights on macOS.
 */

const popupAppMenu = vi.fn();
const minimize = vi.fn();
const toggleMaximize = vi.fn();
const close = vi.fn();

vi.mock("../ipc", () => ({
  windowIpc: { popupAppMenu: (x: number, y: number) => popupAppMenu(x, y) },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize,
    toggleMaximize,
    close,
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
  }),
}));

vi.mock("../settings/SettingsContext", () => ({
  useSettings: () => ({
    t: {
      appMenu: "Menu",
      windowMinimize: "Minimize",
      windowMaximize: "Maximize",
      windowRestore: "Restore Down",
      windowClose: "Close",
    },
  }),
}));

const appDrawsWindowFrame = vi.hoisted(() => ({ value: false }));
vi.mock("./window-chrome", () => ({
  get appDrawsWindowFrame() {
    return appDrawsWindowFrame.value;
  },
}));

const { AppMenuButton, WindowCaptionButtons } =
  await import("./WindowControls");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("where the platform still draws the frame", () => {
  it("renders no caption and no menu button", () => {
    appDrawsWindowFrame.value = false;
    const { container } = render(
      <>
        <AppMenuButton />
        <WindowCaptionButtons />
      </>,
    );
    // macOS has its own traffic lights and its own menu bar; drawing ours
    // next to them would be two of everything.
    expect(container).toBeEmptyDOMElement();
  });
});

describe("where the app owns the frame", () => {
  it("draws minimize, maximize and close", () => {
    appDrawsWindowFrame.value = true;
    render(<WindowCaptionButtons />);

    fireEvent.click(screen.getByLabelText("Minimize"));
    expect(minimize).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByLabelText("Maximize"));
    expect(toggleMaximize).toHaveBeenCalledOnce();

    // close(), never destroy(): the editor's unsaved-document prompt and the
    // chat window's hand-the-conversation-back both hang off close-requested.
    fireEvent.click(screen.getByLabelText("Close"));
    expect(close).toHaveBeenCalledOnce();
  });

  it("anchors the menu popup under the button it was opened from", () => {
    appDrawsWindowFrame.value = true;
    render(<AppMenuButton />);
    const button = screen.getByLabelText("Menu");
    button.getBoundingClientRect = () => ({ left: 12, bottom: 28 }) as DOMRect;

    fireEvent.click(button);
    // Window-relative logical points, which is what popup_menu_at expects -
    // a popup anchored anywhere else reads as a stray context menu.
    expect(popupAppMenu).toHaveBeenCalledWith(12, 28);
  });
});
