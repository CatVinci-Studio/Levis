import { describe, expect, it } from "vitest";
import snapshot from "./models-snapshot.json";
import { FALLBACK_CATALOG } from "./provider-catalog";

type Snapshot = {
  unmapped: string[];
  providers: Record<string, { models: Record<string, { status?: string }> }>;
};

// The TS mirror of catalog.rs is checked against the same models.dev
// snapshot (scripts/sync-models.mjs) as the Rust side, so the two can't
// drift onto models that no longer exist.
describe("provider catalog mirror", () => {
  const data = snapshot as Snapshot;
  for (const entry of FALLBACK_CATALOG) {
    if (data.unmapped.includes(entry.id)) continue;
    it(`pins only current ${entry.id} models`, () => {
      const models = data.providers[entry.id]?.models;
      expect(models, `${entry.id} isn't in the snapshot`).toBeDefined();
      const pinned = [
        entry.defaultModel,
        entry.agentDefaultModel,
        ...entry.knownModels,
      ].filter((m): m is string => !!m);
      for (const id of pinned) {
        expect(models![id], `${entry.id}/${id} is not listed`).toBeDefined();
        expect(models![id].status).not.toBe("deprecated");
      }
    });
  }
});
