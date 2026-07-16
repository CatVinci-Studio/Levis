//! The provider catalog: structural facts about each AI provider (which wire
//! dialect it speaks, how it authenticates, whether that dialect has tool
//! calling wired up) as data instead of scattered `match provider.as_str()`
//! special cases. `ai::agent::ai_agent_message` still owns the actual
//! per-dialect `step` closures - this just lets the frontend build a
//! provider picker without hardcoding the same facts a second time.
//!
//! Mirrored on the TS side by `src/ai/provider-catalog.ts` (id/dialect/auth/
//! toolCalling kept in sync by hand - comments on both sides point here).
//! User-facing labels are NOT part of this catalog: they're already
//! localized i18n strings (`providerCodex` etc. in `src/i18n/strings.ts`),
//! and duplicating them in Rust would just be a second place to translate.

use serde::Serialize;

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCatalogEntry {
    /// Matches `Settings.aiProvider` on the TS side and the `provider`
    /// string `ai_agent_message`/`client::call` dispatch on.
    pub id: &'static str,
    /// The wire format this provider speaks - what an `agent_step`
    /// implementation, if any, is built against. Multiple providers can
    /// share a dialect (codex and apikey are both "openai-responses").
    pub dialect: &'static str,
    pub auth: ProviderAuthKind,
    /// Whether `ai::agent::ai_agent_message` runs the tool-calling loop for
    /// this provider (propose_edit, search_document, ...) rather than
    /// falling back to a single tool-less completion.
    pub tool_calling: bool,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum ProviderAuthKind {
    /// Browser PKCE login (codex_login / claude_login).
    Oauth,
    /// A pasted API key (set_api_key).
    ApiKey,
    /// Base URL + optional key, user-supplied (set_custom_endpoint).
    Custom,
}

pub const PROVIDER_CATALOG: &[ProviderCatalogEntry] = &[
    ProviderCatalogEntry {
        id: "codex",
        dialect: "openai-responses",
        auth: ProviderAuthKind::Oauth,
        tool_calling: true,
    },
    ProviderCatalogEntry {
        id: "apikey",
        dialect: "openai-responses",
        auth: ProviderAuthKind::ApiKey,
        tool_calling: true,
    },
    ProviderCatalogEntry {
        id: "claude",
        dialect: "anthropic-messages",
        auth: ProviderAuthKind::Oauth,
        tool_calling: true,
    },
    ProviderCatalogEntry {
        id: "custom",
        dialect: "openai-chat-completions",
        auth: ProviderAuthKind::Custom,
        tool_calling: false,
    },
];

/// Lets the frontend render a provider list (pi.dev-style) without
/// hardcoding which providers exist or what they support - adding a
/// provider is a new `PROVIDER_CATALOG` entry plus its `agent_step`, not a
/// frontend change too.
#[tauri::command]
pub fn list_providers() -> Vec<ProviderCatalogEntry> {
    PROVIDER_CATALOG.to_vec()
}
