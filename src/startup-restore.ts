import { useEffect } from "react";
import { drafts, windowIpc } from "./ipc";
import {
  helpDocContent,
  makeBlankTab,
  readDocFromDisk,
  type DocTab,
  type HelpDoc,
} from "./doc-tabs";
import type { NewDocumentMode } from "./settings/SettingsContext";

// Module-scoped, NOT a ref: React StrictMode (dev builds) runs mount effects
// twice on the same component, and this drain is a destructive pull from
// shared Rust-side queues (and the drafts store) - a second run would steal
// content meant for other windows or double-claim recovered drafts. Module
// state survives the StrictMode remount; separate windows are separate
// webviews with their own module instance, so each window still drains
// exactly once.
let drained = false;

export interface StartupRestoreOptions {
  activeTabId: string;
  enableDraftRecovery: boolean;
  newDocumentMode: NewDocumentMode;
  language: string;
  onboardingShown: boolean;
  updateTab: (id: string, patch: Partial<DocTab>) => void;
  setTabs: (updater: (prev: DocTab[]) => DocTab[]) => void;
  setDraftsRestoredCount: (n: number) => void;
  markOnboardingShown: () => void;
  openPathInTab: (path: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  startTutorial: (tabId: string) => void;
  stopTutorial: () => void;
}

/**
 * Everything that can claim this window's initial blank tab (or add extra
 * ones) at launch, in priority order: a tab dragged in from another window
 * (which short-circuits everything else - see below), recovered drafts (2.4,
 * never steals focus - just adds tabs), a Help doc this window was spawned to
 * show, OS-handed-over file paths, and finally - if nothing else claimed
 * anything - the first-run tutorial. Runs exactly
 * once per window, at mount; the effect deliberately uses `[]` (not the
 * values it closes over) since a later change to any of them shouldn't
 * re-trigger a second drain.
 */
export function useStartupRestore(opts: StartupRestoreOptions): void {
  useEffect(() => {
    if (drained) return;
    drained = true;
    void (async () => {
      // A tab dragged out of another window's tab bar (see TabBar.tsx /
      // detachTab). Checked FIRST, ahead of draft recovery: this window was
      // created for this one document and must claim nothing else. Draft
      // recovery below is a DESTRUCTIVE drain of the app-wide snapshot pool,
      // and the dragged tab's own snapshot is very likely still in it - the
      // source window clears it asynchronously (draft-autosave.ts) with no
      // ordering guarantee against this window mounting. Draining here would
      // re-add the dragged document as a "recovered" tab and then land it a
      // second time as the detached tab.
      const detached = await windowIpc.takeDetachedTab();
      if (detached) {
        opts.stopTutorial();
        opts.updateTab(opts.activeTabId, detached);
        return;
      }
      // Recovered drafts (2.4): content a previous run snapshotted but never
      // resolved (crash, forced quit) - added as extra tabs, never stealing
      // focus from whatever this launch's OS-open/session claim below picks.
      // Skipped entirely while the privacy toggle is off - any leftover
      // snapshot files just sit unread until Clear or a re-enable.
      const draftSnapshots = opts.enableDraftRecovery
        ? ((await drafts.takeDraftSnapshots()) ?? [])
        : [];
      if (draftSnapshots.length > 0) {
        const restored: DocTab[] = [];
        for (const draft of draftSnapshots) {
          if (!draft.path) {
            restored.push({
              ...makeBlankTab(),
              content: draft.content,
              savedContent: "",
            });
            continue;
          }
          try {
            const { content: diskContent, diskMtime } = await readDocFromDisk(
              draft.path,
            );
            if (diskContent === draft.content) continue; // disk already matches - nothing to recover
            restored.push({
              ...makeBlankTab(),
              path: draft.path,
              content: draft.content,
              savedContent: diskContent,
              diskMtime,
            });
          } catch {
            continue; // file gone or unreadable since the snapshot was taken
          }
        }
        if (restored.length > 0) {
          opts.setTabs((prev) => [...prev, ...restored]);
          opts.setDraftsRestoredCount(restored.length);
        }
      }
      // A Help menu doc clicked with no window open: this window was
      // spawned to show it, so the bundled document rides the blank
      // initial tab instead of opening next to it. "welcome" starts the
      // tutorial on that same already-blank tab instead (same as clicking
      // the Help menu item directly would - see startWelcomeTutorial).
      const helpDoc: string | null = await windowIpc.takePendingShowHelp();
      if (helpDoc === "markdown" || helpDoc === "agent") {
        // A tutorial can be persisted from a previous window. A window born
        // specifically to show a guide must not restore that overlay on top
        // of the guide (nor treat the guide's bundled text as practice).
        opts.stopTutorial();
        const content = helpDocContent(helpDoc as HelpDoc, opts.language);
        opts.updateTab(opts.activeTabId, {
          content,
          savedContent: content,
          helpDoc: helpDoc as HelpDoc,
        });
        return;
      }
      if (helpDoc === "welcome") {
        opts.startTutorial(opts.activeTabId);
        if (!opts.onboardingShown) opts.markOnboardingShown();
        return;
      }
      if (opts.newDocumentMode === "tab") {
        const paths = await windowIpc.takePendingOpenPaths();
        if (paths.length > 0) {
          opts.stopTutorial();
          const [first, ...rest] = paths;
          const { content: text, diskMtime } = await readDocFromDisk(first);
          opts.updateTab(opts.activeTabId, {
            path: first,
            content: text,
            savedContent: text,
            diskMtime,
          });
          for (const p of rest) await opts.openPathInTab(p);
          return;
        }
      } else {
        const pending = await windowIpc.takePendingOpenPath();
        if (pending) {
          opts.stopTutorial();
          await opts.openFile(pending);
          return;
        }
      }
      // Nothing else claimed the initial blank tab and this installation has
      // never shown onboarding. Keeping the durable flag false until this
      // exact point means a first launch that was busy opening a file can
      // defer the guide safely to the next ordinary launch instead of losing
      // it forever.
      if (!opts.onboardingShown) {
        opts.startTutorial(opts.activeTabId);
        opts.markOnboardingShown();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
