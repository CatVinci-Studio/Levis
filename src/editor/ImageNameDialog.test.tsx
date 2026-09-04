// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageNameDialog } from "./ImageNameDialog";

afterEach(cleanup);

function renderDialog(onClose = vi.fn()) {
  render(
    <ImageNameDialog
      request={{ stem: "image", extension: "png", resolve: vi.fn() }}
      title="Upload image"
      label="Filename"
      invalidLabel="Invalid filename"
      uploadLabel="Upload"
      cancelLabel="Cancel"
      onClose={onClose}
    />,
  );
  return onClose;
}

describe("ImageNameDialog", () => {
  it("lets the user edit the stem while keeping the extension fixed", () => {
    const close = renderDialog();
    const input = screen.getByRole("textbox", { name: "Filename" });
    fireEvent.change(input, { target: { value: "homepage-v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(close).toHaveBeenCalledWith("homepage-v2");
    expect(screen.getByText(".png")).toBeTruthy();
  });

  it("rejects path separators", () => {
    const close = renderDialog();
    fireEvent.change(screen.getByRole("textbox", { name: "Filename" }), {
      target: { value: "folder/image" },
    });
    expect(screen.getByText("Invalid filename")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Upload" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });
  it("does not submit from Cancel or while composing text", () => {
    const close = renderDialog();
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), {
      key: "Enter",
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Filename" }), {
      key: "Enter",
      isComposing: true,
    });
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Filename" }), {
      key: "Escape",
    });
    expect(close).toHaveBeenCalledExactlyOnceWith(null);
  });
});
