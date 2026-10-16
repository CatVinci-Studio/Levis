// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCloseOnOutsideClick } from "./useCloseOnOutsideClick";

function Overlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useCloseOnOutsideClick<HTMLDivElement>(onClose, true, open);
  return <div ref={ref}>menu</div>;
}

afterEach(cleanup);

async function settle() {
  // The listeners attach a tick after opening.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe("useCloseOnOutsideClick", () => {
  it("closes an open overlay on Escape and keeps the key to itself", async () => {
    const onClose = vi.fn();
    const later = vi.fn();
    window.addEventListener("keydown", later);
    render(<Overlay open onClose={onClose} />);
    await settle();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onClose).toHaveBeenCalledOnce();
    expect(later).not.toHaveBeenCalled();
    window.removeEventListener("keydown", later);
  });

  // The editor keeps the focus under its context menu; its own Escape
  // (clear the grey suggestion) must not run as well.
  it("takes an Escape from outside before the focused element hears it", async () => {
    const onClose = vi.fn();
    const editor = document.createElement("div");
    const editorEscape = vi.fn();
    editor.addEventListener("keydown", editorEscape);
    document.body.appendChild(editor);
    render(<Overlay open onClose={onClose} />);
    await settle();
    editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onClose).toHaveBeenCalledOnce();
    expect(editorEscape).not.toHaveBeenCalled();
    editor.remove();
  });

  it("lets a field inside the overlay keep its own Escape", async () => {
    const onClose = vi.fn();
    function WithField() {
      const ref = useCloseOnOutsideClick<HTMLDivElement>(onClose, true, true);
      return (
        <div ref={ref}>
          <input
            data-testid="field"
            onKeyDown={(e) => e.key === "Escape" && e.stopPropagation()}
          />
        </div>
      );
    }
    const { getByTestId } = render(<WithField />);
    await settle();
    getByTestId("field").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves Escape and clicks alone while closed", async () => {
    const onClose = vi.fn();
    const later = vi.fn();
    window.addEventListener("keydown", later);
    render(<Overlay open={false} onClose={onClose} />);
    await settle();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    expect(later).toHaveBeenCalledOnce();
    window.removeEventListener("keydown", later);
  });

  // iOS sends no mousedown for a tap on plain text; the touch's pointerdown
  // closes the overlay, and the mousedown that may follow doesn't again.
  it("closes on a touch outside, once", async () => {
    const onClose = vi.fn();
    render(<Overlay open onClose={onClose} />);
    await settle();
    const touch = new MouseEvent("pointerdown", { bubbles: true });
    Object.defineProperty(touch, "pointerType", { value: "touch" });
    document.body.dispatchEvent(touch);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("leaves a mouse press to its mousedown", async () => {
    const onClose = vi.fn();
    render(<Overlay open onClose={onClose} />);
    await settle();
    const press = new MouseEvent("pointerdown", { bubbles: true });
    Object.defineProperty(press, "pointerType", { value: "mouse" });
    document.body.dispatchEvent(press);
    expect(onClose).not.toHaveBeenCalled();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
