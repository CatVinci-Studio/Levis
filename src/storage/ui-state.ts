import { storage } from "../ipc";
import { legacyImportSettled, readBoot } from "./boot";

/**
 * Small bits of UI remembered between launches - not settings the user
 * picks, just where they left things. Kept by Rust in ui-state.json
 * (docs/STORAGE.md); before the move each was its own localStorage key,
 * which is still what the fallback (no Rust boot snapshot) reads and writes.
 *
 * Remembered for the next window or launch, never pushed into windows
 * already open - same as when they were localStorage keys read at mount.
 * Values come back untrusted (an older build, a hand edit); each caller
 * validates its own.
 */
export interface UiState {
  /** The onboarding tour's step (onboarding/useTutorial.ts). */
  tutorialProgress: unknown;
  agentPanelOpen: boolean;
  agentPanelWidth: number;
  /** iOS: recently opened documents, newest first (platform/ios-files.ts). */
  iosRecentDocuments: unknown;
  /** iOS: the document list's layout (mobile/DocumentList.tsx). */
  documentListView: string;
}

export type UiStateKey = keyof UiState;

/** Each field's localStorage key before the move, and how it was encoded
 *  there - for the fallback and for the one-time import. */
const LEGACY: {
  [K in UiStateKey]: {
    key: string;
    decode: (raw: string) => unknown;
    encode: (value: UiState[K]) => string;
  };
} = {
  tutorialProgress: {
    key: "levis-tutorial-progress",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  agentPanelOpen: {
    key: "levis-agent-panel-open",
    decode: (raw) => raw === "1",
    encode: (value) => (value ? "1" : "0"),
  },
  agentPanelWidth: {
    key: "levis-agent-panel-width",
    decode: (raw) => Number(raw),
    encode: (value) => String(Math.round(value)),
  },
  iosRecentDocuments: {
    key: "levis-ios-recent-documents",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  documentListView: {
    key: "levis.documentListView",
    decode: (raw) => raw,
    encode: (value) => value,
  },
};

function readLegacy(key: UiStateKey): unknown {
  try {
    const raw = localStorage.getItem(LEGACY[key].key);
    return raw === null ? undefined : LEGACY[key].decode(raw);
  } catch {
    return undefined;
  }
}

/** Every field localStorage holds, for the one-time import. */
export function readLegacyUiState(): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const key of Object.keys(LEGACY) as UiStateKey[]) {
    const value = readLegacy(key);
    if (value !== undefined) state[key] = value;
  }
  return state;
}

let cache: Record<string, unknown> | null = null;
/** Fields written in this page since it loaded: newer than any re-read. */
const written = new Set<string>();
let refreshed: Promise<void> | null = null;

function fileCache(): Record<string, unknown> | null {
  const boot = readBoot();
  if (!boot) return null;
  if (!cache) {
    // Before the import has reached Rust, the snapshot is empty and
    // localStorage is still where the values are.
    cache = boot.legacyImport ? readLegacyUiState() : { ...boot.uiState };
    refreshed = legacyImportSettled()
      .then(() => storage.uiStateGet())
      .then((live) => {
        const local = cache ?? {};
        cache = { ...live };
        for (const key of written) cache[key] = local[key];
      })
      .catch(() => {});
  }
  return cache;
}

export function getUiState<K extends UiStateKey>(key: K): unknown {
  const file = fileCache();
  return file ? file[key] : readLegacy(key);
}

export function setUiState<K extends UiStateKey>(
  key: K,
  value: UiState[K],
): void {
  const file = fileCache();
  if (file) {
    file[key] = value;
    written.add(key);
    storage.uiStatePatch({ [key]: value }).catch(() => {});
    return;
  }
  try {
    localStorage.setItem(LEGACY[key].key, LEGACY[key].encode(value));
  } catch {
    // Storage unavailable: it just won't be remembered.
  }
}

/** Resolves once the live values have replaced the boot snapshot - for a
 *  read-modify-write (the iOS recents list) that must not build on a
 *  snapshot a page reload left stale. */
export function uiStateReady(): Promise<void> {
  fileCache();
  return refreshed ?? Promise.resolve();
}

/** Drops the cache, for tests that install a different boot snapshot. */
export function resetUiStateForTests(): void {
  cache = null;
  refreshed = null;
  written.clear();
}
