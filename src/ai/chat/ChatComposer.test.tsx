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
import type { ChatAttachment } from "../types";

const pickAttachmentFile = vi.fn();
let supportsVision = true;

// The composer derives vision support from the active provider itself (so no
// caller can forget to pass it), which is what this stands in for.
vi.mock("../provider-catalog", () => ({
  useActiveProvider: () => ({ supportsVision }),
}));

vi.mock("../../ipc", async () => {
  const actual =
    await vi.importActual<typeof import("../../ipc")>("../../ipc");
  return {
    ...actual,
    ai: {
      loadAgentWorkspace: vi.fn().mockResolvedValue({ skills: [] }),
      pickAttachmentFile: () => pickAttachmentFile(),
    },
  };
});

const { ChatComposer } = await import("./ChatComposer");
const { IpcError } = await import("../../ipc");

const labels = {
  dropSelection: "Remove selection",
  placeholder: "Ask anything",
  send: "Send",
  stop: "Stop",
  attachFile: "Attach a file",
  selectedChars: "{n} chars selected",
  attachmentTruncated: "(shortened)",
  attachmentNoVision: "This provider can't read images.",
};

type ComposerOptions = {
  selectedText?: string | null;
  onSend?: (
    message: string,
    attachments: ChatAttachment[],
    includeSelection: boolean,
  ) => void;
};

function composer({ selectedText = null, onSend = () => {} }: ComposerOptions) {
  return (
    <ChatComposer
      docPath={null}
      workspaceRoot={null}
      selectedText={selectedText}
      busy={false}
      labels={labels}
      onSend={onSend}
      onStop={() => {}}
      onEscape={() => {}}
    />
  );
}

function renderComposer(options: ComposerOptions = {}) {
  const onSend = options.onSend ?? vi.fn();
  return { ...render(composer({ ...options, onSend })), onSend };
}

const imageAttachment: ChatAttachment = {
  kind: "image",
  name: "chart.png",
  mime: "image/png",
  dataBase64: "AAAA",
};

beforeEach(() => {
  pickAttachmentFile.mockReset();
  supportsVision = true;
});

// No vitest globals config, so RTL's auto-cleanup never registers - without
// this every later query sees the previous test's DOM too.
afterEach(cleanup);

describe("ChatComposer selection chip", () => {
  it("brings the chip back for a NEW selection after one was dismissed", () => {
    // The detached Agent window is the cross-file surface: the user goes on
    // highlighting passages while it is open, and each new highlight is a
    // fresh request to talk about it. A dismissal that stuck for the rest of
    // the chat meant every later selection silently failed to ride along.
    const { rerender } = renderComposer({ selectedText: "first passage" });
    expect(screen.getByText(/13 chars selected/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Remove selection"));
    expect(screen.queryByText(/chars selected/)).not.toBeInTheDocument();

    rerender(composer({ selectedText: "a different passage" }));
    expect(screen.getByText(/19 chars selected/)).toBeInTheDocument();
  });

  it("keeps the chip dismissed while that same selection is current", () => {
    // The other half: dismissing must survive an unrelated re-render, or the
    // chip would pop back the moment anything else in the window changed.
    const { rerender } = renderComposer({ selectedText: "first passage" });
    fireEvent.click(screen.getByLabelText("Remove selection"));

    rerender(composer({ selectedText: "first passage" }));
    expect(screen.queryByText(/chars selected/)).not.toBeInTheDocument();
  });

  it("tells send whether the selection should ride along", () => {
    const { onSend } = renderComposer({ selectedText: "passage" });
    fireEvent.change(screen.getByPlaceholderText("Ask anything"), {
      target: { value: "tighten this" },
    });
    fireEvent.click(screen.getByText("Send"));
    expect(onSend).toHaveBeenCalledWith("tighten this", [], true);
  });
});

describe("ChatComposer attachments", () => {
  it("shows why a file could not be attached instead of doing nothing", async () => {
    // The regression this pins: every failure used to be swallowed by a
    // `.catch(() => null)`, so picking a PDF - which could not work at all -
    // was indistinguishable from a dead "+" button.
    pickAttachmentFile.mockRejectedValue(
      new IpcError("pick_attachment_file", "This PDF has no text layer."),
    );
    renderComposer();

    fireEvent.click(screen.getByTitle("Attach a file"));
    expect(
      await screen.findByText("This PDF has no text layer."),
    ).toBeInTheDocument();
  });

  it("refuses an image when the provider has no vision", async () => {
    supportsVision = false;
    pickAttachmentFile.mockResolvedValue(imageAttachment);
    renderComposer();

    fireEvent.click(screen.getByTitle("Attach a file"));
    expect(
      await screen.findByText("This provider can't read images."),
    ).toBeInTheDocument();
    expect(screen.queryByText("chart.png")).not.toBeInTheDocument();
  });

  it("stages an image when the provider can read one", async () => {
    pickAttachmentFile.mockResolvedValue(imageAttachment);
    renderComposer();

    fireEvent.click(screen.getByTitle("Attach a file"));
    expect(await screen.findByText("chart.png")).toBeInTheDocument();
  });

  it("says so when an attachment was cut at the extraction cap", async () => {
    // Silence here would read as "the model has my whole file" when it has
    // only the first part of it.
    pickAttachmentFile.mockResolvedValue({
      kind: "text",
      name: "big.pdf",
      content: "...",
      truncated: true,
    } satisfies ChatAttachment);
    renderComposer();

    fireEvent.click(screen.getByTitle("Attach a file"));
    expect(await screen.findByText("(shortened)")).toBeInTheDocument();
  });

  it("hands staged attachments to send and clears them", async () => {
    pickAttachmentFile.mockResolvedValue(imageAttachment);
    const { onSend } = renderComposer();

    fireEvent.click(screen.getByTitle("Attach a file"));
    await screen.findByText("chart.png");
    fireEvent.change(screen.getByPlaceholderText("Ask anything"), {
      target: { value: "what is this?" },
    });
    fireEvent.click(screen.getByText("Send"));

    expect(onSend).toHaveBeenCalledWith(
      "what is this?",
      [imageAttachment],
      true,
    );
    await waitFor(() =>
      expect(screen.queryByText("chart.png")).not.toBeInTheDocument(),
    );
  });
});
