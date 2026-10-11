import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { documentDir, join } from "@tauri-apps/api/path";
import type { DirEntryInfo } from "../sidebar/types";
import { isIOSApp } from "./capabilities";

/**
 * iOS document access (src-tauri/plugins/levis-files). A file or folder the
 * user picks in the Files app is addressed by its `file://` URL and read and
 * written through the native plugin, which holds the security scope; the
 * app's own Documents folder keeps plain paths and the ordinary Rust file
 * commands. ipc.ts's `fs` decides per call - nothing else needs to know.
 */

/** True for a picked file or folder (a URL) rather than a sandbox path. */
export function isScopedUrl(path: string): boolean {
  return isIOSApp && path.startsWith("file://");
}

type Picked = { url: string | null; name?: string; folder?: boolean };

const call = <T>(command: string, args?: Record<string, unknown>) =>
  invoke<T>(`plugin:levis-files|${command}`, args ? { args } : undefined);

/** A pick from the app's own Documents folder as the plain path the rest of
 *  the app (the file tree, open tabs) knows it by - otherwise the same file
 *  opens twice, once per spelling. Anything else stays a URL. */
async function inDocuments(url: string | null): Promise<string | null> {
  if (!url?.startsWith("file://")) return url;
  const path = decodeURIComponent(new URL(url).pathname);
  const docs = (await documentDir()).replace(/\/+$/, "") + "/";
  // /private/var and /var are the same place; the picker may say either.
  const bare = (p: string) => p.replace(/^\/private(?=\/var\/)/, "");
  return bare(path).startsWith(bare(docs))
    ? docs + bare(path).slice(bare(docs).length)
    : url;
}

export const iosFiles = {
  /** The Files app's document picker; null when cancelled. */
  pickDocument: async (): Promise<string | null> =>
    inDocuments((await call<Picked>("pick_document")).url),
  readText: async (url: string): Promise<string> =>
    (await call<{ text: string }>("read_text", { url })).text,
  /** The share sheet (AirDrop, Messages, Mail, Save to Files...) for a
   *  saved document - a plain path or a picked file's URL. */
  share: (path: string): Promise<void> => call<void>("share", { path }),
  readBase64: async (url: string): Promise<string> =>
    (await call<{ data: string }>("read_data", { url })).data,
  writeText: (url: string, text: string): Promise<void> =>
    call<void>("write_text", { url, text }),
  listFolder: async (url: string): Promise<DirEntryInfo[]> =>
    (
      await call<{
        entries: { url: string; name: string; folder: boolean }[];
      }>("list_folder", { url })
    ).entries.map((e) => ({ name: e.name, path: e.url, is_dir: e.folder })),
  /** Picked files and folders that survive a relaunch. */
  remembered: async () =>
    (
      await call<{ items: { url: string; name: string; folder: boolean }[] }>(
        "remembered",
      )
    ).items,
  /** Opens a picked folder for the rest of the session and returns its
   *  plain path, which the Rust side can read like any other. */
  beginAccess: async (url: string): Promise<string> =>
    (await call<{ path: string }>("begin_access", { url })).path,
  /** Picks a folder for the project and opens it: its plain path, or null. */
  pickProjectFolder: async (): Promise<string | null> => {
    const url = (await call<Picked>("pick_folder")).url;
    return url ? iosFiles.beginAccess(url) : null;
  },
};

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  heic: "image/heic",
};

/**
 * An image a picked document refers to by a relative path, as a data: URL.
 * The webview can't load a security-scoped file itself, so the plugin reads
 * it - which works when the image is inside a picked folder (a document
 * picked on its own grants access to that one file only).
 */
export async function scopedImageSrc(
  src: string,
  docUrl: string,
): Promise<string> {
  const url = new URL(src, docUrl).href;
  const ext = url.split(".").pop()?.toLowerCase() ?? "";
  const type = IMAGE_TYPES[ext] ?? "application/octet-stream";
  return `data:${type};base64,${await iosFiles.readBase64(url)}`;
}

/**
 * Reopens the folders picked in earlier sessions. Their plain paths are
 * still in settings (the project folder), but an iOS scope ends with the
 * process: without this the AI could no longer read the project after a
 * relaunch. Documents need nothing - each read resolves its bookmark.
 */
export async function restoreFolderAccess(): Promise<void> {
  if (!isIOSApp) return;
  const { items } = await call<{
    items: { url: string; folder: boolean }[];
  }>("remembered");
  await Promise.all(
    items
      .filter((item) => item.folder)
      .map((item) => iosFiles.beginAccess(item.url).catch(() => null)),
  );
}

/** The app's Documents folder - "On My iPhone > Levis" in the Files app,
 *  where new documents are saved and what the file tree shows by default.
 *  Null until it resolves, and always null on desktop. */
export function useIOSDocumentsFolder(): string | null {
  const [dir, setDir] = useState<string | null>(null);
  useEffect(() => {
    if (!isIOSApp) return;
    let alive = true;
    void documentDir().then((path) => alive && setDir(path));
    return () => {
      alive = false;
    };
  }, []);
  return dir;
}

/**
 * Where "Save" puts a new document on iOS: the Documents folder, under the
 * suggested name - numbered ("Notes 2.md") rather than overwriting a file
 * that is already there. There is no save panel to ask with.
 */
export async function newDocumentPath(
  defaultName: string,
  exists: (path: string) => Promise<boolean>,
): Promise<string> {
  const dir = await documentDir();
  const dot = defaultName.lastIndexOf(".");
  const stem = dot > 0 ? defaultName.slice(0, dot) : defaultName;
  const ext = dot > 0 ? defaultName.slice(dot) : ".md";
  for (let n = 1; ; n++) {
    const path = await join(
      dir,
      n === 1 ? `${stem}${ext}` : `${stem} ${n}${ext}`,
    );
    if (!(await exists(path))) return path;
  }
}

const RECENT_DOCUMENTS_KEY = "levis-ios-recent-documents";
const RECENT_LIMIT = 8;
/** Prefix for a path stored relative to Documents: the app's container
 *  moves on every reinstall and App Store update, so an absolute path into
 *  it would be stale by the next version. */
const IN_DOCUMENTS = "documents:";

function readRecents(): string[] {
  try {
    const list: unknown = JSON.parse(
      localStorage.getItem(RECENT_DOCUMENTS_KEY) ?? "[]",
    );
    return Array.isArray(list)
      ? list.filter((p): p is string => typeof p === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * The documents opened most recently, newest first - File > Open Recent on
 * the phone, and the first is what reopens at launch: iOS ends a
 * backgrounded app whenever it likes, and the desktop's per-window session
 * (session.rs) and recents list (menu.rs) are not built there.
 */
export async function recentIOSDocuments(): Promise<string[]> {
  const docs = await documentDir();
  return Promise.all(
    readRecents().map((stored) =>
      stored.startsWith(IN_DOCUMENTS)
        ? join(docs, stored.slice(IN_DOCUMENTS.length))
        : Promise.resolve(stored),
    ),
  );
}

export async function lastIOSDocument(): Promise<string | null> {
  return (await recentIOSDocuments())[0] ?? null;
}

export async function rememberIOSDocument(path: string | null): Promise<void> {
  // Only ever added to, never cleared: the blank tab every launch starts
  // with would otherwise wipe it before startup gets to read it.
  if (!isIOSApp || !path) return;
  const docs = (await documentDir()).replace(/\/+$/, "") + "/";
  const stored = path.startsWith(docs)
    ? IN_DOCUMENTS + path.slice(docs.length)
    : path;
  const list = [stored, ...readRecents().filter((p) => p !== stored)];
  try {
    localStorage.setItem(
      RECENT_DOCUMENTS_KEY,
      JSON.stringify(list.slice(0, RECENT_LIMIT)),
    );
  } catch {
    // Storage unavailable: the next launch just starts blank.
  }
}

/** Drops an entry that no longer opens (moved or deleted in Files). */
export async function forgetIOSDocument(path: string): Promise<void> {
  const resolved = await recentIOSDocuments();
  const stored = readRecents();
  try {
    localStorage.setItem(
      RECENT_DOCUMENTS_KEY,
      JSON.stringify(stored.filter((_, i) => resolved[i] !== path)),
    );
  } catch {
    // Nothing to do.
  }
}
