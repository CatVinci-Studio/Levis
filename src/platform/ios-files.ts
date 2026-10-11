import { invoke } from "@tauri-apps/api/core";
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

export const iosFiles = {
  /** The Files app's document picker; null when cancelled. */
  pickDocument: async (): Promise<string | null> =>
    (await call<Picked>("pick_document")).url,
  /** A folder to use as the project; null when cancelled. */
  pickFolder: async (): Promise<string | null> =>
    (await call<Picked>("pick_folder")).url,
  readText: async (url: string): Promise<string> =>
    (await call<{ text: string }>("read_text", { url })).text,
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
  forget: (url: string): Promise<void> => call<void>("forget", { url }),
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
