import { useEffect, useState } from "react";
import { ai } from "../ipc";

/**
 * Structural facts about each AI provider, fetched from the Rust catalog
 * (src-tauri/src/ai/catalog.rs - fields kept in sync by hand, comments on
 * both sides point here) so the provider picker in Settings doesn't
 * hardcode the same facts a second time. Provider ids are plain strings now
 * (not a closed union) - the catalog itself is the source of truth for
 * which ones exist.
 */
export interface ProviderCatalogEntry {
  id: string;
  label: string;
  dialect:
    "openai-responses" | "anthropic-messages" | "openai-chat-completions";
  /** Auth methods this provider supports, in preference order. */
  auth: ("oauth" | "api_key" | "custom")[];
  baseUrl: string | null;
  /** Low-cost default shared by completion and grammar checking. */
  defaultModel: string | null;
  /** Stronger default used only by Agent chat. */
  agentDefaultModel: string | null;
  keyOptional: boolean;
  /** False when a live model-list fetch is known not to work. */
  modelsListable: boolean;
  /** A small pre-supplied set of current model ids (pi.dev's models.json
   *  idea) - seeds the picker before, or in place of, any live fetch. */
  knownModels: string[];
}

export function fetchProviderCatalog(): Promise<ProviderCatalogEntry[]> {
  return ai.listProviders();
}

/// Mirrors the Rust catalog's static entries (src-tauri/src/ai/catalog.rs) -
/// used as the initial render and as the dev-shim fallback, where
/// `invoke("list_providers")` resolves to `null` instead of the real list.
export const FALLBACK_CATALOG: ProviderCatalogEntry[] = [
  {
    id: "openai",
    label: "OpenAI",
    dialect: "openai-responses",
    auth: ["oauth", "api_key"],
    baseUrl: null,
    defaultModel: "gpt-5.4-nano",
    agentDefaultModel: "gpt-5.6-sol",
    keyOptional: false,
    modelsListable: true,
    knownModels: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    dialect: "anthropic-messages",
    auth: ["oauth", "api_key"],
    baseUrl: null,
    defaultModel: "claude-haiku-4-5-20251001",
    agentDefaultModel: "claude-sonnet-5",
    keyOptional: false,
    modelsListable: true,
    knownModels: [
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
    ],
  },
  {
    id: "custom",
    label: "Custom Endpoint",
    dialect: "openai-chat-completions",
    auth: ["custom"],
    baseUrl: null,
    defaultModel: null,
    agentDefaultModel: null,
    keyOptional: true,
    modelsListable: true,
    knownModels: [],
  },
];

/// Shared catalog fetch (fallback -> real list once it resolves) - both the
/// provider picker and the Agent tab's model picker need the same data, so
/// this is the one place that owns fetching it.
export function useProviderCatalog(): ProviderCatalogEntry[] {
  const [catalog, setCatalog] =
    useState<ProviderCatalogEntry[]>(FALLBACK_CATALOG);

  useEffect(() => {
    fetchProviderCatalog()
      .then((list) => {
        if (list?.length) setCatalog(list);
      })
      .catch(() => {});
  }, []);

  return catalog;
}
