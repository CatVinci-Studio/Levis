import { documentDir } from "@tauri-apps/api/path";

/**
 * Paths into the iOS app's own Documents folder, as stored between
 * launches. The app's container - and with it the absolute path of
 * everything in Documents - moves on every reinstall and App Store update
 * (and on a simulator reinstall), so a path stored absolute points nowhere
 * by the next version. Such a path is stored as "documents:<path inside
 * Documents>" instead and resolved against the current folder when read:
 * the recent documents (ios-files.ts) and the chat history's document
 * (ai/chat-history.ts). Desktop paths are stored as they are.
 */
export const IN_DOCUMENTS = "documents:";

/** The Documents folder of an iOS app container inside an absolute path:
 *  this install's, or an earlier one's, whose container id differs -
 *  `.../Containers/Data/Application/<id>/Documents/<rest>` (the simulator
 *  nests the same layout under CoreSimulator). Only plain paths: a file
 *  picked in the Files app is a `file://` URL, kept as it is. */
const CONTAINER_DOCUMENTS =
  /^\/.*\/Containers\/Data\/Application\/[0-9A-Fa-f-]+\/Documents\/(.+)$/;

const withSlash = (dir: string) => dir.replace(/\/+$/, "") + "/";

/**
 * `path` as stored: relative to Documents when it is inside the current
 * Documents folder `docs` (when known) or any app container's Documents
 * folder - which an absolute path stored by an earlier install is - and
 * unchanged otherwise. Already-stored paths come back as they are.
 */
export function storedDocumentPath(path: string, docs: string | null): string {
  if (path.startsWith(IN_DOCUMENTS)) return path;
  if (docs && path.startsWith(withSlash(docs)))
    return IN_DOCUMENTS + path.slice(withSlash(docs).length);
  const match = CONTAINER_DOCUMENTS.exec(path);
  return match ? IN_DOCUMENTS + match[1] : path;
}

/** A stored path as a path in the current Documents folder `docs` - for a
 *  relative one, and for an absolute one into an earlier install's
 *  container. Anything else comes back as it is. */
export function resolvedDocumentPath(stored: string, docs: string): string {
  const inside = stored.startsWith(IN_DOCUMENTS)
    ? stored.slice(IN_DOCUMENTS.length)
    : CONTAINER_DOCUMENTS.exec(stored)?.[1];
  return inside === undefined ? stored : withSlash(docs) + inside;
}

let known: string | null = null;
let loading: Promise<string> | null = null;

/** The app's Documents folder, with a trailing slash. Asked of Tauri once:
 *  it doesn't change while the app runs. */
export function documentsDir(): Promise<string> {
  loading ??= documentDir().then(
    (dir) => (known = withSlash(dir)),
    (err: unknown) => {
      loading = null;
      throw err;
    },
  );
  return loading;
}

/** The Documents folder if documentsDir has answered already, else null. */
export function knownDocumentsDir(): string | null {
  return known;
}

/** Forgets the folder, for tests. */
export function resetDocumentsDirForTests(): void {
  known = null;
  loading = null;
}
