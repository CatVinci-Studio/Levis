// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocTab } from "./doc-tabs";

const ipc = vi.hoisted(() => ({
  takeDetachedTab: vi.fn(),
  takePendingShowHelp: vi.fn(),
  takePendingOpenPaths: vi.fn(),
  takePendingOpenPath: vi.fn(),
  takeDraftSnapshots: vi.fn(),
}));

vi.mock("./ipc", () => ({
  windowIpc: {
    takeDetachedTab: ipc.takeDetachedTab,
    takePendingShowHelp: ipc.takePendingShowHelp,
    takePendingOpenPaths: ipc.takePendingOpenPaths,
    takePendingOpenPath: ipc.takePendingOpenPath,
  },
  drafts: { takeDraftSnapshots: ipc.takeDraftSnapshots },
}));
vi.mock("./platform/capabilities", () => ({
  canUseWindows: true,
  hasAppMenu: true,
  isIOSApp: false,
}));
vi.mock("./platform/ios-files", () => ({
  lastIOSDocument: vi.fn().mockResolvedValue(null),
}));
vi.mock("./doc-tabs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./doc-tabs")>()),
  readDocFromDisk: vi.fn(async (path: string) => ({
    content: `# ${path}\n`,
    diskMtime: 1,
  })),
}));

const INITIAL: DocTab = {
  id: "initial",
  path: null,
  content: "",
  savedContent: "",
  diskMtime: null,
  sourceMode: false,
  reloadKey: 0,
};

/** Runs the hook against a tab list held here, the way App holds it. */
async function restore(newDocumentMode: "tab" | "window" = "tab") {
  // `drained` is module state (one drain per window): a fresh module each.
  vi.resetModules();
  const { useStartupRestore } = await import("./startup-restore");
  let tabs: DocTab[] = [{ ...INITIAL }];
  const openPathInTab = vi.fn(async () => {});
  const openFile = vi.fn(async () => {});
  renderHook(() =>
    useStartupRestore({
      activeTabId: INITIAL.id,
      enableDraftRecovery: true,
      newDocumentMode,
      language: "en",
      onboardingShown: true,
      setTabs: (update) => {
        tabs = update(tabs);
      },
      setDraftsRestoredCount: vi.fn(),
      markOnboardingShown: vi.fn(),
      openPathInTab,
      openFile,
      startTutorial: vi.fn(),
      stopTutorial: vi.fn(),
    }),
  );
  return { tabs: () => tabs, openPathInTab, openFile };
}

beforeEach(() => {
  vi.clearAllMocks();
  ipc.takeDetachedTab.mockResolvedValue(null);
  ipc.takePendingShowHelp.mockResolvedValue(null);
  ipc.takePendingOpenPaths.mockResolvedValue([]);
  ipc.takePendingOpenPath.mockResolvedValue(null);
  ipc.takeDraftSnapshots.mockResolvedValue([]);
});
afterEach(cleanup);

describe("startup restore into the initial tab", () => {
  // The initial tab's editor can mount before the restore's IPC round trips
  // finish, and reads its content only at mount: whatever lands in that tab
  // must move reloadKey on, or the editor keeps showing an empty document
  // over the file the tab now holds.
  it("remounts the initial tab's editor on the first restored document", async () => {
    ipc.takePendingOpenPaths.mockResolvedValue(["/docs/a.md", "/docs/b.md"]);
    const { tabs, openPathInTab } = await restore("tab");
    await waitFor(() =>
      expect(openPathInTab).toHaveBeenCalledWith("/docs/b.md"),
    );
    expect(tabs()).toEqual([
      expect.objectContaining({
        id: "initial",
        path: "/docs/a.md",
        content: "# /docs/a.md\n",
        savedContent: "# /docs/a.md\n",
        reloadKey: 1,
      }),
    ]);
  });

  it("does the same for a tab dragged in from another window", async () => {
    ipc.takeDetachedTab.mockResolvedValue({
      path: "/docs/dragged.md",
      content: "dragged, with edits",
      savedContent: "dragged",
      diskMtime: 5,
    });
    const { tabs } = await restore();
    await waitFor(() => expect(tabs()[0].path).toBe("/docs/dragged.md"));
    expect(tabs()[0]).toMatchObject({
      content: "dragged, with edits",
      savedContent: "dragged",
      reloadKey: 1,
    });
  });

  it("and for a guide this window was opened to show", async () => {
    ipc.takePendingShowHelp.mockResolvedValue("markdown");
    const { tabs } = await restore();
    await waitFor(() => expect(tabs()[0].helpDoc).toBe("markdown"));
    expect(tabs()[0].content).not.toBe("");
    expect(tabs()[0].reloadKey).toBe(1);
  });

  it("leaves the initial tab alone when nothing claims it", async () => {
    const { tabs, openFile } = await restore("window");
    await waitFor(() => expect(ipc.takePendingOpenPath).toHaveBeenCalled());
    expect(openFile).not.toHaveBeenCalled();
    expect(tabs()).toEqual([INITIAL]);
  });
});
