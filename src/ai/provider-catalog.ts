import { invoke } from "@tauri-apps/api/core";
import type { AiProvider } from "../settings/SettingsContext";

/**
 * Structural facts about each AI provider, fetched from the Rust catalog
 * (src-tauri/src/ai/catalog.rs - id/dialect/auth/toolCalling kept in sync by
 * hand, comments on both sides point here) so the provider list in Settings
 * doesn't hardcode the same facts a second time. User-facing labels are NOT
 * part of this catalog - those are the existing localized `providerCodex`
 * etc. keys in src/i18n/strings.ts.
 */
export interface ProviderCatalogEntry {
  id: AiProvider;
  dialect: "openai-responses" | "anthropic-messages" | "openai-chat-completions";
  auth: "oauth" | "api_key" | "custom";
  toolCalling: boolean;
}

export function fetchProviderCatalog(): Promise<ProviderCatalogEntry[]> {
  return invoke<ProviderCatalogEntry[]>("list_providers");
}
