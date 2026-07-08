use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One entry in an agent conversation. Kept provider-agnostic so the main
/// crate's loop doesn't need to know about each provider's wire format.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind")]
pub enum AgentTurn {
    User { text: String },
    Assistant { text: String },
    ToolCall { call_id: String, name: String, arguments: String },
    ToolResult { call_id: String, output: String },
}

/// A tool the model may call. `parameters` is a JSON schema object.
pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub parameters: Value,
}

/// What a single model turn produced: either it's done talking (with
/// optional text), or it wants to call one or more tools before continuing.
pub enum StepResult {
    Done(String),
    ToolCalls(Vec<AgentTurn>),
}
