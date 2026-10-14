// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { saveConversation, useChatHistory } from "./chat-history";
import { storage } from "../ipc";

// The iOS app, whose container moved since the last version: the old
// conversation's absolute path points into the previous container.
const { DOCS, OLD } = vi.hoisted(() => ({
  DOCS: "/var/mobile/Containers/Data/Application/0000-AAAA/Documents",
  OLD: "/var/mobile/Containers/Data/Application/1111-BBBB/Documents",
}));

vi.mock("../platform/capabilities", () => ({ isIOSApp: true }));
vi.mock("@tauri-apps/api/path", () => ({
  documentDir: () => Promise.resolve(DOCS),
}));
vi.mock("../settings/SettingsContext", () => ({
  loadSettings: () => ({ enableChatHistory: true }),
}));
vi.mock("../ipc", () => ({
  storage: {
    historyList: vi.fn(),
    historyUpsert: vi.fn().mockResolvedValue(null),
    historyRemove: vi.fn().mockResolvedValue(null),
    historyClear: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("../utils/tauri-events", () => ({
  listenToThisWindow: () => Promise.resolve(() => {}),
}));

const entry = (id: string, docPath: string | null, updatedAt: number) => ({
  id,
  docPath,
  title: id,
  updatedAt,
  turns: [],
});

beforeAll(() => {
  (window as unknown as { __BOOT__: unknown }).__BOOT__ = {
    settings: {},
    rev: 1,
    uiState: {},
    legacyImport: false,
    label: "main",
  };
});

describe("chat history on iOS", () => {
  it("keeps document paths relative to Documents, so a new container finds them", async () => {
    vi.mocked(storage.historyList).mockResolvedValue([
      entry("old", `${OLD}/novel/ch1.md`, 3),
      entry("picked", "file:///private/var/mobile/Library/x/a.md", 2),
      entry("draft", null, 1),
    ]);
    const { result } = renderHook(() => useChatHistory());

    // Read back in this container's Documents folder...
    await waitFor(() =>
      expect(result.current.map((e) => e.docPath)).toEqual([
        `${DOCS}/novel/ch1.md`,
        "file:///private/var/mobile/Library/x/a.md",
        null,
      ]),
    );
    // ...and the old absolute path rewritten in the file, once, as it was.
    expect(vi.mocked(storage.historyUpsert).mock.calls).toEqual([
      ["chat", entry("old", "documents:novel/ch1.md", 3)],
    ]);

    // A conversation saved now stores its document relative too.
    act(() => saveConversation(entry("new", `${DOCS}/novel/ch2.md`, 4)));
    expect(storage.historyUpsert).toHaveBeenLastCalledWith(
      "chat",
      entry("new", "documents:novel/ch2.md", 4),
    );
    // Both in the same folder - one project group in the Chats panel.
    expect(result.current.map((e) => e.docPath).slice(0, 2)).toEqual([
      `${DOCS}/novel/ch2.md`,
      `${DOCS}/novel/ch1.md`,
    ]);
  });
});
