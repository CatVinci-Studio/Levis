use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One entry in an agent conversation. Kept provider-agnostic so the main
/// crate's loop doesn't need to know about each provider's wire format.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind")]
pub enum AgentTurn {
    User {
        text: String,
    },
    Assistant {
        text: String,
    },
    ToolCall {
        call_id: String,
        name: String,
        arguments: String,
    },
    ToolResult {
        call_id: String,
        output: String,
    },
}

/// A tool the model may call. `parameters` is a JSON schema object.
#[derive(Clone)]
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

/// A live fragment surfaced while a provider's `agent_step` is still
/// reading its response - assistant prose as it's generated, and tool
/// calls as their JSON arguments accumulate. Purely additive: every
/// provider still returns the same complete [`StepResult`] at the end,
/// so a caller that ignores these events loses nothing but liveness.
///
/// Borrowed strs on purpose: events fire from inside SSE read loops, and
/// most sinks only forward them (serializing to owned data anyway).
pub enum ProviderEvent<'a> {
    /// A chunk of the assistant's prose for the in-progress turn.
    Text(&'a str),
    /// The model opened a tool call - its arguments follow as ToolArgs.
    ToolStart { call_id: &'a str, name: &'a str },
    /// A raw fragment of a tool call's JSON `arguments` string. Fragments
    /// concatenate to the same string the final ToolCall turn carries;
    /// consumers doing live display must parse it as PARTIAL json.
    ToolArgs { call_id: &'a str, delta: &'a str },
}

/// The callback streaming-capable `agent_step`s report [`ProviderEvent`]s
/// through. A shared reference (not a generic) so provider signatures stay
/// object-simple and a no-op `&|_| {}` works at call sites without events.
pub type EventSink<'a> = &'a (dyn Fn(ProviderEvent<'_>) + Send + Sync);

/// Runs the tool-calling round-trip loop shared by every agent-capable
/// provider: feed the model the turn history, and if it asks to call tools,
/// run them and feed the results back, until it produces a final answer or
/// `max_steps` is hit.
///
/// This knows nothing about any specific provider's wire format (that's
/// `step`'s job) or what tools actually do (that's `execute_tool`'s job) - it
/// only owns turn bookkeeping. That separation is what lets a new provider or
/// a new tool source (e.g. an MCP server down the line) plug in without
/// touching this loop: a provider implements `step`, a tool source
/// contributes entries that `execute_tool` can dispatch to.
///
/// `on_turn` fires for every intermediate turn as it lands (each ToolCall
/// and its ToolResult) - the loop-level counterpart of [`ProviderEvent`],
/// letting a UI show tool activity live. The final Assistant turn is NOT
/// reported: its text already streamed out as ProviderEvent::Text, and the
/// returned turn list is the authoritative ending either way.
pub async fn run_agent_loop<Step, StepFut, ExecuteTool, OnTurn>(
    history: Vec<AgentTurn>,
    user_message: String,
    max_steps: usize,
    mut step: Step,
    mut execute_tool: ExecuteTool,
    mut on_turn: OnTurn,
) -> Result<Vec<AgentTurn>, String>
where
    Step: FnMut(Vec<AgentTurn>) -> StepFut,
    StepFut: std::future::Future<Output = Result<StepResult, String>>,
    ExecuteTool: FnMut(&str, &str) -> String,
    OnTurn: FnMut(&AgentTurn),
{
    let user_turn = AgentTurn::User { text: user_message };
    let mut turns = history;
    turns.push(user_turn.clone());
    let mut new_turns = vec![user_turn];

    for _ in 0..max_steps {
        match step(turns.clone()).await? {
            StepResult::Done(text) => {
                let turn = AgentTurn::Assistant { text };
                turns.push(turn.clone());
                new_turns.push(turn);
                break;
            }
            StepResult::ToolCalls(calls) => {
                for call in calls {
                    let AgentTurn::ToolCall {
                        call_id,
                        name,
                        arguments,
                    } = &call
                    else {
                        continue;
                    };
                    on_turn(&call);
                    turns.push(call.clone());
                    new_turns.push(call.clone());

                    let output = execute_tool(name, arguments);
                    let result_turn = AgentTurn::ToolResult {
                        call_id: call_id.clone(),
                        output,
                    };
                    on_turn(&result_turn);
                    turns.push(result_turn.clone());
                    new_turns.push(result_turn);
                }
            }
        }
    }

    Ok(new_turns)
}
