// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createPersistedList } from "./persisted-list";
import { storage } from "../ipc";
import { resetBootForTests } from "../storage/boot";
import { installTestLocalStorage } from "../test-local-storage";

const handlers: Record<string, (event: { payload: unknown }) => void> = {};

vi.mock("../ipc", () => ({
  storage: {
    historyList: vi.fn(),
    historyUpsert: vi.fn().mockResolvedValue(null),
    historyRemove: vi.fn().mockResolvedValue(null),
    historyClear: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("./tauri-events", () => ({
  listenToThisWindow: (
    event: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    handlers[event] = handler;
    return Promise.resolve(() => {});
  },
}));

interface Entry {
  id: string;
  at: number;
}

function makeList() {
  return createPersistedList<Entry>("test-list", {
    kind: "chat",
    max: 3,
    keyOf: (e) => e.id,
    isEntry: (e): e is Entry => typeof (e as Entry)?.id === "string",
    sort: (a, b) => b.at - a.at,
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(installTestLocalStorage);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetBootForTests();
});

afterEach(() => {
  delete (window as unknown as { __BOOT__?: unknown }).__BOOT__;
});

describe("without Rust (localStorage)", () => {
  it("keeps the list under its key, capped and sorted", () => {
    const list = makeList();
    for (let i = 0; i < 5; i++) list.upsert({ id: `e${i}`, at: i });
    list.upsert({ id: "e3", at: 9 });
    expect(list.get().map((e) => e.id)).toEqual(["e3", "e4", "e2"]);
    expect(JSON.parse(localStorage.getItem("test-list")!)).toHaveLength(3);
    expect(storage.historyUpsert).not.toHaveBeenCalled();
  });
});

describe("with Rust (file-backed)", () => {
  beforeEach(() => {
    (window as unknown as { __BOOT__: unknown }).__BOOT__ = {
      settings: {},
      rev: 1,
      uiState: {},
      legacyImport: false,
      label: "main",
    };
  });

  it("loads from Rust and sends one entry per change, never the list", async () => {
    vi.mocked(storage.historyList).mockResolvedValue([
      { id: "a", at: 1 },
      { broken: true },
    ]);
    const list = makeList();
    expect(list.get()).toEqual([]);
    await flush();
    expect(list.get()).toEqual([{ id: "a", at: 1 }]);
    list.upsert({ id: "b", at: 2 });
    list.remove("a");
    list.clear();
    expect(storage.historyUpsert).toHaveBeenCalledWith("chat", {
      id: "b",
      at: 2,
    });
    expect(storage.historyRemove).toHaveBeenCalledWith("chat", "a");
    expect(storage.historyClear).toHaveBeenCalledWith("chat");
    expect(localStorage.getItem("test-list")).toBeNull();
  });

  it("keeps a change made before the first load arrives", async () => {
    let answer!: (list: unknown[]) => void;
    vi.mocked(storage.historyList).mockReturnValue(
      new Promise((resolve) => (answer = resolve)),
    );
    const list = makeList();
    list.get();
    await flush();
    list.upsert({ id: "new", at: 5 });
    // Rust's answer predates the upsert.
    answer([{ id: "old", at: 1 }]);
    await flush();
    expect(list.get().map((e) => e.id)).toEqual(["new", "old"]);
  });

  it("applies other windows' changes and skips its own", async () => {
    vi.mocked(storage.historyList).mockResolvedValue([]);
    const list = makeList();
    // Subscribing is what a sidebar panel does.
    list.get();
    await flush();
    const event = (op: object, from = "window-2", kind = "chat") =>
      handlers["history-changed"]({ payload: { kind, op, from } });
    event({ type: "upsert", entry: { id: "x", at: 1 } });
    event({ type: "upsert", entry: { id: "y", at: 2 } }, "main");
    event(
      { type: "upsert", entry: { id: "z", at: 3 } },
      "window-2",
      "clipboard",
    );
    expect(list.get().map((e) => e.id)).toEqual(["x"]);
    event({ type: "remove", key: "x" });
    expect(list.get()).toEqual([]);
    // The legacy import replaced the whole list: fetch it again.
    vi.mocked(storage.historyList).mockResolvedValue([
      { id: "imported", at: 1 },
    ]);
    event({ type: "reload" }, "");
    await flush();
    expect(list.get().map((e) => e.id)).toEqual(["imported"]);
  });
});
