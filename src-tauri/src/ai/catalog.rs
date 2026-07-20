//! The provider catalog: one entry per supported AI service, as data instead
//! of scattered `match provider.as_str()` special cases. `ai::route::resolve`
//! turns an entry plus stored credentials into a concrete request target.
//!
//! Mirrored on the TS side by `src/ai/provider-catalog.ts` (kept in sync by
//! hand - comments on both sides point here). Labels are brand names, shared
//! across languages, so they live here rather than in i18n - the one
//! exception is "custom", whose label the frontend localizes.

use serde::Serialize;

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCatalogEntry {
    /// Matches `Settings.aiProvider` on the TS side and the `provider`
    /// string every ai_* command dispatches on.
    pub id: &'static str,
    pub label: &'static str,
    /// The wire format this provider speaks: "openai-responses",
    /// "anthropic-messages", or "openai-chat-completions".
    pub dialect: &'static str,
    /// Auth methods the provider supports, in preference order:
    /// "oauth" (browser PKCE login), "api_key", "custom" (user-supplied
    /// endpoint config).
    pub auth: &'static [&'static str],
    /// Fixed endpoint for chat-completions providers; None when the dialect
    /// implies it (OpenAI/Anthropic) or the user supplies it ("custom").
    pub base_url: Option<&'static str>,
    /// Low-cost model used by writing completion and grammar checking until
    /// the user picks one in Settings. Agent chat has its own, generally
    /// stronger default below.
    pub default_model: Option<&'static str>,
    /// Model used by Agent chat until the user picks one in Settings. Keeping
    /// this separate from `default_model` prevents inline writing helpers
    /// from silently inheriting a more expensive Agent model.
    pub agent_default_model: Option<&'static str>,
    /// True for local servers (Ollama) that work without a key.
    pub key_optional: bool,
    /// False when a live GET /models call is known not to work for this
    /// provider (verified against the real endpoint - see the doc comment on
    /// `KNOWN_MODELS` below) - the frontend hides the "Fetch Models" action
    /// and relies solely on `known_models` instead of also offering a button
    /// that can only ever fail.
    pub models_listable: bool,
    /// A small pre-supplied set of current model ids, same idea as pi.dev's
    /// bundled models.json: seeds the picker with usable choices before (or
    /// instead of, when `models_listable` is false) any live fetch, so the
    /// dropdown is never just empty for a provider whose API can't list its
    /// own models.
    pub known_models: &'static [&'static str],
}

pub const PROVIDER_CATALOG: &[ProviderCatalogEntry] = &[
    ProviderCatalogEntry {
        id: "openai",
        label: "OpenAI",
        dialect: "openai-responses",
        auth: &["oauth", "api_key"],
        base_url: None,
        default_model: Some("gpt-5.4-nano"),
        agent_default_model: Some("gpt-5.6-sol"),
        key_optional: false,
        models_listable: true,
        known_models: &["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
    },
    ProviderCatalogEntry {
        id: "anthropic",
        label: "Anthropic",
        dialect: "anthropic-messages",
        auth: &["oauth", "api_key"],
        base_url: None,
        default_model: Some("claude-haiku-4-5-20251001"),
        agent_default_model: Some("claude-sonnet-5"),
        key_optional: false,
        models_listable: true,
        known_models: &[
            "claude-fable-5",
            "claude-opus-4-8",
            "claude-sonnet-5",
            "claude-haiku-4-5-20251001",
        ],
    },
    ProviderCatalogEntry {
        id: "google",
        label: "Google Gemini",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://generativelanguage.googleapis.com/v1beta/openai"),
        default_model: Some("gemini-3.1-flash-lite"),
        agent_default_model: Some("gemini-3.5-flash"),
        key_optional: false,
        // Gemini's OpenAI compatibility API now implements GET /models with
        // the standard OpenAI list shape, so the generic model fetch works.
        models_listable: true,
        known_models: &[
            "gemini-3.5-flash",
            "gemini-3.1-pro-preview",
            "gemini-3.1-flash-lite",
            "gemini-2.5-pro",
            "gemini-2.5-flash",
        ],
    },
    ProviderCatalogEntry {
        id: "deepseek",
        label: "DeepSeek",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://api.deepseek.com/v1"),
        default_model: Some("deepseek-v4-flash"),
        agent_default_model: Some("deepseek-v4-pro"),
        key_optional: false,
        models_listable: true,
        known_models: &["deepseek-v4-pro", "deepseek-v4-flash"],
    },
    ProviderCatalogEntry {
        id: "xai",
        label: "xAI Grok",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://api.x.ai/v1"),
        default_model: Some("grok-4.5"),
        agent_default_model: Some("grok-4.5"),
        key_optional: false,
        models_listable: true,
        known_models: &["grok-4.5", "grok-4.5-latest"],
    },
    ProviderCatalogEntry {
        id: "mistral",
        label: "Mistral",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://api.mistral.ai/v1"),
        default_model: Some("mistral-small-latest"),
        agent_default_model: Some("mistral-large-latest"),
        key_optional: false,
        models_listable: true,
        known_models: &[
            "mistral-large-latest",
            "mistral-small-latest",
            "magistral-medium-latest",
        ],
    },
    ProviderCatalogEntry {
        id: "groq",
        label: "Groq",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://api.groq.com/openai/v1"),
        default_model: Some("llama-3.1-8b-instant"),
        agent_default_model: Some("openai/gpt-oss-120b"),
        key_optional: false,
        models_listable: true,
        known_models: &[
            "openai/gpt-oss-120b",
            "openai/gpt-oss-20b",
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
        ],
    },
    ProviderCatalogEntry {
        id: "openrouter",
        label: "OpenRouter",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://openrouter.ai/api/v1"),
        default_model: Some("openrouter/free"),
        agent_default_model: Some("openrouter/auto"),
        key_optional: false,
        // The one third-party catalog with a genuinely public /models list
        // (no key required) - still worth a known_models seed for the
        // instant-render case before that request resolves.
        models_listable: true,
        known_models: &["openrouter/auto", "openrouter/free"],
    },
    ProviderCatalogEntry {
        id: "moonshot",
        label: "Moonshot Kimi",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://api.moonshot.cn/v1"),
        default_model: Some("kimi-k2.5"),
        agent_default_model: Some("kimi-k3"),
        key_optional: false,
        models_listable: true,
        known_models: &["kimi-k3", "kimi-k2.7-code", "kimi-k2.6", "kimi-k2.5"],
    },
    ProviderCatalogEntry {
        id: "zhipu",
        label: "Zhipu GLM",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://open.bigmodel.cn/api/paas/v4"),
        default_model: Some("glm-4-flash"),
        agent_default_model: Some("glm-5.2"),
        key_optional: false,
        models_listable: true,
        known_models: &["glm-5.2", "glm-5.1", "glm-5", "glm-4.7", "glm-4-flash"],
    },
    ProviderCatalogEntry {
        id: "qwen",
        label: "Alibaba Qwen",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("https://dashscope.aliyuncs.com/compatible-mode/v1"),
        default_model: Some("qwen-flash"),
        agent_default_model: Some("qwen3.7-plus"),
        key_optional: false,
        models_listable: true,
        known_models: &["qwen3.7-max", "qwen3.7-plus", "qwen-plus", "qwen-flash"],
    },
    ProviderCatalogEntry {
        id: "ollama",
        label: "Ollama (local)",
        dialect: "openai-chat-completions",
        auth: &["api_key"],
        base_url: Some("http://localhost:11434/v1"),
        default_model: None,
        agent_default_model: None,
        key_optional: true,
        // Whatever's installed locally, which only the user's own server
        // knows - there's no sensible fixed seed list, but the local
        // /v1/models route does work, so fetching is still worthwhile.
        models_listable: true,
        known_models: &[],
    },
    ProviderCatalogEntry {
        id: "custom",
        label: "Custom Endpoint",
        dialect: "openai-chat-completions",
        auth: &["custom"],
        base_url: None,
        default_model: None,
        agent_default_model: None,
        key_optional: true,
        models_listable: true,
        known_models: &[],
    },
];

pub fn find(id: &str) -> Option<&'static ProviderCatalogEntry> {
    PROVIDER_CATALOG.iter().find(|e| e.id == id)
}

#[tauri::command]
pub fn list_providers() -> Vec<ProviderCatalogEntry> {
    PROVIDER_CATALOG.to_vec()
}
