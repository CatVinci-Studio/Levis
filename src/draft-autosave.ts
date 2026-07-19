import { useEffect, useRef } from "react";
import { tabIsDirty, type DocTab } from "./doc-tabs";
import { drafts } from "./ipc";

const DEBOUNCE_MS = 3000;
const MAX_WAIT_MS = 30000;

interface Pending {
  content: string;
  timer: ReturnType<typeof setTimeout>;
  firstPendingAt: number;
}

/**
 * Best-effort crash/force-quit recovery (2.4): every dirty tab's content is
 * snapshotted to disk a few seconds after typing settles, or at least every
 * 30s during a long unbroken typing burst. A tab drops out of tracking the
 * moment it becomes clean (saved) or disappears from `tabs` (closed, or
 * handed off to another window in a tab drag) - in every case its on-disk
 * snapshot is cleared, since whatever it protected against has been
 * resolved one way or another. Restoring these at startup is App.tsx's job
 * (see the mount-time drain effect); this hook only ever writes.
 *
 * `enabled` is Settings > Privacy > Draft Recovery - while off, no new
 * snapshots are scheduled (existing on-disk ones are left as they are; the
 * privacy section's own "Clear" button is what removes them).
 */
export function useDraftAutosave(tabs: DocTab[], enabled: boolean): void {
  const pendingRef = useRef<Map<string, Pending>>(new Map());
  const knownIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const pending = pendingRef.current;
    const seenIds = new Set(tabs.map((tab) => tab.id));

    for (const id of knownIdsRef.current) {
      if (seenIds.has(id)) continue;
      clearTimeout(pending.get(id)?.timer);
      pending.delete(id);
      void drafts.clearDraftSnapshot(id);
    }
    knownIdsRef.current = seenIds;

    if (!enabled) return;

    for (const tab of tabs) {
      const existing = pending.get(tab.id);
      if (!tabIsDirty(tab)) {
        if (existing) {
          clearTimeout(existing.timer);
          pending.delete(tab.id);
          void drafts.clearDraftSnapshot(tab.id);
        }
        continue;
      }
      if (existing && existing.content === tab.content) continue; // nothing new since last schedule
      if (existing) clearTimeout(existing.timer);

      const firstPendingAt = existing?.firstPendingAt ?? Date.now();
      const delay =
        Date.now() - firstPendingAt >= MAX_WAIT_MS ? 0 : DEBOUNCE_MS;
      const path = tab.path;
      const content = tab.content;
      const timer = setTimeout(() => {
        void drafts.saveDraftSnapshot(tab.id, path, content);
        const p = pending.get(tab.id);
        if (p) p.firstPendingAt = Date.now(); // restart the hard-cap clock after a flush
      }, delay);
      pending.set(tab.id, { content: tab.content, timer, firstPendingAt });
    }
  }, [tabs, enabled]);
}
