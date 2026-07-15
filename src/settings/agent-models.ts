/// Codex's OAuth token can't list models (GET /v1/models 403s - see the
/// comment on fetch_agent_models in src-tauri/src/ai/client.rs), so unlike
/// claude/apikey it gets a small hardcoded list instead of a live fetch.
export const CODEX_MODEL_PRESETS = [
  { value: "", label: "gpt-5.4-mini (default, fast)" },
  { value: "gpt-5.4", label: "gpt-5.4 (stronger)" },
];
