import { invoke } from "@tauri-apps/api/core";
import type { Strings } from "./i18n/strings";
import { basename } from "./utils/path";
import markdownGuideEn from "./help/markdown-guide.en.md?raw";
import markdownGuideZh from "./help/markdown-guide.zh.md?raw";
import markdownGuideJa from "./help/markdown-guide.ja.md?raw";
import agentGuideEn from "./help/agent-guide.en.md?raw";
import agentGuideZh from "./help/agent-guide.zh.md?raw";
import agentGuideJa from "./help/agent-guide.ja.md?raw";
import welcomeEn from "./help/welcome.en.md?raw";
import welcomeZh from "./help/welcome.zh.md?raw";
import welcomeJa from "./help/welcome.ja.md?raw";

// The document-tab data model shared by App.tsx (tab state) and
// useTabDragMerge.ts (tabs in flight between windows).

// Mirrors the doc ids Rust puts in its Help menu ids (menu.rs
// HELP_DOC_PREFIX) - they arrive here as the menu-open-help payload.
// "welcome" additionally starts the step-by-step tutorial mode (see
// src/onboarding/) - the App.tsx menu-open-help handler is what does that,
// this type only tracks which bundled doc backs the tab.
export type HelpDoc = "markdown" | "agent" | "welcome";

export interface DocTab {
  id: string;
  path: string | null;
  content: string;
  // What's on disk (or "" for a fresh draft) - dirtiness is divergence from
  // this, and it's what the close-confirmation prompt keys off.
  savedContent: string;
  // Disk mtime (ms) snapshotted when this document was last read from or
  // written to disk; null for drafts and for documents whose mtime is
  // unknown (e.g. a tab received from another window). Divergence from the
  // live mtime means the file changed externally - clean tabs reload on
  // window focus, dirty tabs get an overwrite prompt on save.
  diskMtime: number | null;
  sourceMode: boolean;
  reloadKey: number;
  // A bundled Help menu document: still a pathless draft (edits never touch
  // disk; Save goes through Save As), but titled after itself instead of
  // "Untitled", and deduped per doc so Help focuses the existing tab rather
  // than opening another copy.
  helpDoc?: HelpDoc;
}

// The document part of a tab in flight between windows - what
// start_floating_tab_drag hands to Rust and take_detached_tab /
// receive-detached-tab hand back (tab_drag.rs DetachedTab).
export interface DetachedTabDoc {
  path: string | null;
  content: string;
  savedContent: string;
  diskMtime: number | null;
  helpDoc?: HelpDoc;
}

export function helpDocContent(doc: HelpDoc, lang: string): string {
  if (doc === "agent") {
    if (lang === "zh") return agentGuideZh;
    if (lang === "ja") return agentGuideJa;
    return agentGuideEn;
  }
  if (doc === "welcome") {
    if (lang === "zh") return welcomeZh;
    if (lang === "ja") return welcomeJa;
    return welcomeEn;
  }
  if (lang === "zh") return markdownGuideZh;
  if (lang === "ja") return markdownGuideJa;
  return markdownGuideEn;
}

// A tab's display name everywhere one is shown (tab pill, title strip,
// detached-drag pill, export default filename).
export function tabTitle(tab: DocTab, t: Strings): string {
  if (tab.path) return basename(tab.path);
  if (tab.helpDoc === "markdown") return t.markdownGuideTab;
  if (tab.helpDoc === "agent") return t.agentGuideTab;
  if (tab.helpDoc === "welcome") return t.welcomeTab;
  return t.untitledTab;
}

export function makeBlankTab(): DocTab {
  return {
    id: crypto.randomUUID(),
    path: null,
    content: "",
    savedContent: "",
    diskMtime: null,
    sourceMode: false,
    reloadKey: 0,
  };
}

export function tabIsDirty(tab: DocTab): boolean {
  return tab.content !== tab.savedContent;
}

// The full invoke arguments for start_floating_tab_drag - built here so the
// two drag flows (tab pulled from a bar, whole single-tab window dragged)
// can't drift apart on which fields travel with the document.
export function floatingDragArgs(tab: DocTab, t: Strings, destroySource: boolean) {
  return {
    tab: {
      path: tab.path,
      content: tab.content,
      savedContent: tab.savedContent,
      diskMtime: tab.diskMtime,
      helpDoc: tab.helpDoc ?? null,
    },
    title: tabTitle(tab, t),
    dirty: tabIsDirty(tab),
    destroySource,
  };
}

// Errors (permission issues, network mounts) are treated the same as "no
// mtime available": external-change detection degrades to doing nothing
// rather than blocking opens/saves.
export async function statMtime(path: string): Promise<number | null> {
  try {
    return await invoke<number | null>("file_mtime_ms", { path });
  } catch {
    return null;
  }
}

export async function readDocFromDisk(path: string): Promise<{ content: string; diskMtime: number | null }> {
  const content = await invoke<string>("read_text_file", { path });
  return { content, diskMtime: await statMtime(path) };
}
