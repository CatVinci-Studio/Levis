//! Shared machinery for the live evaluation: credentials and model choice,
//! a bounded worker pool, the agent conversation runner (the app's real
//! prompts, tools and loop, plus the frontend's accept/annotate steps), the
//! Opus judge, and the recorder that writes every case's output and scores
//! to disk.

use super::checks::{self, Caret, Proposal};
use crate::ai::agent::{
    build_instructions, compact_history, request_context, request_user_text, MAX_STEPS,
};
use crate::ai::tools::{self, ToolContext};
use crate::ai::workspace::AgentWorkspace;
use aicompat::agent::{run_agent_loop, AgentTurn, StepResult};
use aicompat::providers::anthropic::{self, AnthropicAuth, StepUsage};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

// ------------------------------------------------------------- environment

pub fn auth() -> Option<AnthropicAuth> {
    let path = std::env::var("LEVIS_ANTHROPIC_KEY_FILE")
        .unwrap_or_else(|_| format!("{}/../.anthropic-api-key.local", env!("CARGO_MANIFEST_DIR")));
    match std::fs::read_to_string(&path) {
        Ok(key) if !key.trim().is_empty() => Some(AnthropicAuth::ApiKey(key.trim().to_string())),
        _ => {
            eprintln!("live_eval: no API key at {path} - skipping");
            None
        }
    }
}

pub fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

/// The shipped agent default, unless LEVIS_EVAL_AGENT_MODEL overrides it
/// (how the matrix is re-run against another model).
pub fn agent_model() -> String {
    std::env::var("LEVIS_EVAL_AGENT_MODEL").unwrap_or_else(|_| {
        crate::ai::catalog::find("anthropic")
            .and_then(|e| e.agent_default_model)
            .expect("anthropic has an agent default")
            .to_string()
    })
}

/// The shipped writing (completion + grammar) model, unless
/// LEVIS_EVAL_WRITING_MODEL overrides it.
pub fn writing_model() -> String {
    std::env::var("LEVIS_EVAL_WRITING_MODEL")
        .unwrap_or_else(|_| anthropic::COMPLETION_MODEL.to_string())
}

/// The writing model as `call_completion` takes it: None is the default
/// path (thinking disabled), exactly what a fresh install sends.
pub fn writing_model_arg(model: &str) -> Option<&str> {
    (model != anthropic::COMPLETION_MODEL).then_some(model)
}

pub const JUDGE_MODEL: &str = "claude-opus-5-5";

fn judge_enabled() -> bool {
    std::env::var("LEVIS_EVAL_JUDGE").map_or(true, |v| v != "0")
}

/// LEVIS_EVAL_FILTER: run only cases whose id contains this substring.
pub fn selected(id: &str) -> bool {
    std::env::var("LEVIS_EVAL_FILTER").map_or(true, |f| f.split(',').any(|f| id.contains(f.trim())))
}

/// Runs `f` over `items` on LEVIS_EVAL_JOBS worker threads (default 6),
/// keeping the input order in the output. The API is the bottleneck, not
/// the CPU - this is what keeps a 150-case matrix to minutes.
pub fn par_map<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let jobs: usize = std::env::var("LEVIS_EVAL_JOBS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(6);
    let next = AtomicUsize::new(0);
    let results: Mutex<Vec<Option<R>>> = Mutex::new((0..items.len()).map(|_| None).collect());
    std::thread::scope(|scope| {
        for _ in 0..jobs.max(1) {
            scope.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::SeqCst);
                if i >= items.len() {
                    break;
                }
                let r = f(&items[i]);
                results.lock().unwrap()[i] = Some(r);
            });
        }
    });
    results
        .into_inner()
        .unwrap()
        .into_iter()
        .map(|r| r.expect("every item ran"))
        .collect()
}

fn transient(err: &str) -> bool {
    [
        "429",
        "529",
        "500",
        "502",
        "503",
        "overloaded",
        "timed out",
        "connection",
        "error sending",
    ]
    .iter()
    .any(|m| err.to_lowercase().contains(m))
}

/// Retries rate limits and overloads with backoff - a matrix run fires
/// hundreds of requests, and one 529 shouldn't count as a quality failure.
pub fn with_retry<T>(mut attempt: impl FnMut() -> Result<T, String>) -> Result<T, String> {
    let mut last = String::new();
    for wait in [0u64, 3, 10, 30] {
        if wait > 0 {
            std::thread::sleep(std::time::Duration::from_secs(wait));
        }
        match attempt() {
            Ok(v) => return Ok(v),
            Err(e) if transient(&e) => last = e,
            Err(e) => return Err(e),
        }
    }
    Err(last)
}

/// One completion-style call (completion, grammar, judge) with retries.
pub fn complete(
    auth: &AnthropicAuth,
    instructions: &str,
    user_text: &str,
    model: Option<&str>,
) -> Result<(String, u128), String> {
    let started = Instant::now();
    let text = with_retry(|| {
        block_on(anthropic::call_completion(
            auth,
            instructions.to_string(),
            user_text.to_string(),
            model,
        ))
    })?;
    Ok((text, started.elapsed().as_millis()))
}

// -------------------------------------------------------------------- agent

/// One user message in a scripted conversation and what the "user" does
/// with the proposals it produces before sending the next message.
#[derive(Clone)]
pub struct UserTurn {
    pub message: String,
    pub caret: Caret,
    pub accept: bool,
}

impl UserTurn {
    pub fn new(message: impl Into<String>) -> UserTurn {
        UserTurn {
            message: message.into(),
            caret: Caret::default(),
            accept: true,
        }
    }
}

#[derive(Clone, Default)]
pub struct TurnOutcome {
    pub message: String,
    pub turns: Vec<AgentTurn>,
    pub proposals: Vec<Proposal>,
    /// propose_edit calls the tool rejected (bad anchor, missing field) -
    /// each one cost the user a round trip of waiting.
    pub invalid_proposals: usize,
    pub comments: Vec<(String, String)>,
    pub reply: String,
    pub tools: Vec<String>,
    pub doc_before: String,
    pub doc_after: String,
    pub apply_error: Option<String>,
    pub latency_ms: u128,
    pub usage: Vec<StepUsage>,
}

pub struct Conversation {
    pub outcomes: Vec<TurnOutcome>,
}

impl Conversation {
    pub fn last(&self) -> &TurnOutcome {
        self.outcomes.last().expect("at least one turn")
    }
    pub fn latency_ms(&self) -> u128 {
        self.outcomes.iter().map(|o| o.latency_ms).sum()
    }
    pub fn tokens(&self) -> (u64, u64) {
        let mut io = (0, 0);
        for u in self.outcomes.iter().flat_map(|o| &o.usage) {
            io.0 += u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
            io.1 += u.output_tokens;
        }
        io
    }
}

pub struct AgentSetup<'a> {
    pub model: &'a str,
    pub mode: &'a str,
    pub workspace: &'a AgentWorkspace,
    pub focus_heading: Option<&'a str>,
}

/// Mirrors src/ai/proposal-status.ts's notes for the two decided states.
const ACCEPTED_NOTE: &str =
    "Status: the user accepted this proposed edit - the document text in this request includes it.";
const REJECTED_NOTE: &str =
    "Status: the user rejected this proposed edit - it was not applied. Don't propose it again unless asked.";

/// Runs a scripted conversation the way the app does: each message goes out
/// with the current document (request_context), the loop runs the real
/// tools, the stored history keeps the plain message, and before the next
/// message the user accepts or rejects the proposals - accepted ones are
/// applied to the document (as the frontend composes them) and every
/// proposal's tool result gets the status note the frontend adds.
pub fn run_conversation(
    auth: &AnthropicAuth,
    setup: &AgentSetup,
    document: &str,
    script: &[UserTurn],
) -> Result<Conversation, String> {
    let ws = setup.workspace;
    let root = ws.root.as_deref().map(Path::new);
    let tool_set =
        tools::builtin_tools(!ws.skills.is_empty(), root.is_some(), setup.mode == "edit");
    let specs = tools::tool_specs(&tool_set);
    let mut history: Vec<AgentTurn> = Vec::new();
    let mut doc = document.to_string();
    let mut outcomes = Vec::new();

    for user in script {
        let instructions = build_instructions(ws, &doc, true, setup.mode, &user.message);
        let ctx = ToolContext {
            document: &doc,
            skills: &ws.skills,
            root,
        };
        let usage = RefCell::new(Vec::new());
        let started = Instant::now();
        let mut turns = block_on(run_agent_loop(
            compact_history(history.clone()),
            AgentTurn::User {
                text: request_user_text(
                    &request_context(ws, &doc, true, &user.message, setup.focus_heading),
                    &user.message,
                ),
                images: Vec::new(),
            },
            MAX_STEPS,
            |h: Vec<AgentTurn>| {
                let (instructions, specs, usage) = (&instructions, &specs, &usage);
                async move {
                    // with_retry's loop, inline: this already runs inside
                    // block_on, which can't be nested.
                    let mut waits = [3u64, 10, 30].into_iter();
                    let (step, used): (StepResult, StepUsage) = loop {
                        match anthropic::agent_step_with_usage(
                            auth,
                            instructions,
                            &h,
                            specs,
                            false,
                            setup.model,
                            &|_| {},
                        )
                        .await
                        {
                            Ok(v) => break v,
                            Err(e) if transient(&e) => match waits.next() {
                                Some(w) => std::thread::sleep(std::time::Duration::from_secs(w)),
                                None => return Err(e),
                            },
                            Err(e) => return Err(e),
                        }
                    };
                    usage.borrow_mut().push(used);
                    Ok(step)
                }
            },
            |name, args| tools::execute(&tool_set, &ctx, name, args),
            |_| {},
        ))?;
        let latency_ms = started.elapsed().as_millis();

        // What history keeps is the plain message (ai_agent_message_inner).
        if let Some(AgentTurn::User { text, .. }) = turns.first_mut() {
            *text = user.message.clone();
        }

        let mut outcome = TurnOutcome {
            message: user.message.clone(),
            doc_before: doc.clone(),
            latency_ms,
            usage: usage.into_inner(),
            ..TurnOutcome::default()
        };
        let mut proposal_ids = Vec::new();
        for (i, turn) in turns.iter().enumerate() {
            match turn {
                AgentTurn::ToolCall {
                    call_id,
                    name,
                    arguments,
                } => {
                    outcome.tools.push(name.clone());
                    let result = match turns.get(i + 1) {
                        Some(AgentTurn::ToolResult { output, .. }) => output.as_str(),
                        _ => "",
                    };
                    let args: Value = serde_json::from_str(arguments).unwrap_or_default();
                    if name == "propose_edit" {
                        if result.starts_with("Edit proposed") {
                            outcome.proposals.push(Proposal::from_json(&args));
                            proposal_ids.push(call_id.clone());
                        } else {
                            outcome.invalid_proposals += 1;
                        }
                    }
                    if name == "add_comment" && result.starts_with("Comment added") {
                        let s = |k: &str| args[k].as_str().unwrap_or("").to_string();
                        outcome.comments.push((s("anchor"), s("comment")));
                    }
                }
                AgentTurn::Assistant { text } => outcome.reply = text.clone(),
                _ => {}
            }
        }

        if user.accept && !outcome.proposals.is_empty() {
            match checks::apply_all(&doc, &outcome.proposals, user.caret) {
                Ok(next) => doc = next,
                Err(e) => outcome.apply_error = Some(e),
            }
        }
        outcome.doc_after = doc.clone();

        let note = if user.accept && outcome.apply_error.is_none() {
            ACCEPTED_NOTE
        } else {
            REJECTED_NOTE
        };
        for turn in turns.iter_mut() {
            if let AgentTurn::ToolResult { call_id, output } = turn {
                if proposal_ids.contains(call_id) {
                    *output = format!("{output}\n\n[{note}]");
                }
            }
        }
        history.extend(turns.iter().cloned());
        outcome.turns = turns;
        outcomes.push(outcome);
    }
    Ok(Conversation { outcomes })
}

// -------------------------------------------------------------------- judge

#[derive(Clone, Debug, Default)]
pub struct Verdict {
    pub scores: BTreeMap<String, Option<f64>>,
    pub reasons: String,
}

impl Verdict {
    pub fn min(&self) -> Option<f64> {
        self.scores.values().flatten().copied().reduce(f64::min)
    }
    pub fn mean(&self) -> Option<f64> {
        let v: Vec<f64> = self.scores.values().flatten().copied().collect();
        (!v.is_empty()).then(|| v.iter().sum::<f64>() / v.len() as f64)
    }
}

const JUDGE_INSTRUCTIONS: &str = "You grade the output of the AI features of Levis, a Markdown writing app, for a regression evaluation. Be strict and specific: the bar is a careful professional editor who is fluent in the language of the text.

Score each criterion from 1 to 5: 5 = could not reasonably be improved; 4 = good, minor nits only; 3 = acceptable but with a flaw the user would notice; 2 = poor - the user would have to redo much of it; 1 = wrong, harmful, or ignores the request. Use null when a criterion genuinely does not apply.

Criteria:
- faithfulness: keeps the author's meaning and facts and invents nothing; statements about the document are accurate.
- helpfulness: does what the user actually asked, in the form they wanted - a document edit when they asked for a change, an answer when they asked a question, comments when they asked for a review.
- minimality: changes only what the request needs; untouched text, formatting and Markdown structure stay exactly as they were. For an answer with no edit, judge whether it stayed on point without padding.
- tone: natural, idiomatic writing in the right language and register, matching the author's voice; no machine-written tics (inflated words, filler, needless em dashes or bold).
- correctness: language rules (replies in the language the user wrote in, document text in the document's language unless asked otherwise), valid Markdown, and correct code, math and facts.

Task-specific expectations follow the task; where they conflict with the general criteria, they win.

Respond with ONLY a JSON object, no fences: {\"faithfulness\": n|null, \"helpfulness\": n|null, \"minimality\": n|null, \"tone\": n|null, \"correctness\": n|null, \"reasons\": \"for every score below 5, one short sentence naming the specific flaw\"}";

/// Asks Opus to grade one case. None when judging is switched off
/// (LEVIS_EVAL_JUDGE=0) or the judge's reply can't be parsed twice over.
pub fn judge(
    auth: &AnthropicAuth,
    task: &str,
    expectations: &str,
    material: &str,
) -> Option<Verdict> {
    if !judge_enabled() {
        return None;
    }
    let user = format!(
        "<task>\n{task}\n</task>\n\n<expectations>\n{expectations}\n</expectations>\n\n{material}"
    );
    for _ in 0..2 {
        let Ok((raw, _)) = complete(auth, JUDGE_INSTRUCTIONS, &user, Some(JUDGE_MODEL)) else {
            continue;
        };
        let (Some(start), Some(end)) = (raw.find('{'), raw.rfind('}')) else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<Value>(&raw[start..=end]) else {
            continue;
        };
        let mut verdict = Verdict {
            reasons: v["reasons"].as_str().unwrap_or("").to_string(),
            ..Verdict::default()
        };
        for key in [
            "faithfulness",
            "helpfulness",
            "minimality",
            "tone",
            "correctness",
        ] {
            verdict.scores.insert(key.into(), v[key].as_f64());
        }
        return Some(verdict);
    }
    None
}

/// The judge's view of an agent conversation: each message, the reply, the
/// comments, and every accepted edit as before/after of the changed span
/// with a little context.
pub fn conversation_material(conv: &Conversation) -> String {
    let mut out = String::new();
    for (i, o) in conv.outcomes.iter().enumerate() {
        if i == 0 {
            out.push_str(&format!(
                "<document-before>\n{}\n</document-before>\n\n",
                clip(&o.doc_before, 9_000)
            ));
        }
        out.push_str(&format!(
            "<user-message turn=\"{}\">\n{}\n</user-message>\n",
            i + 1,
            o.message
        ));
        if o.proposals.is_empty() {
            out.push_str("<edits>none proposed</edits>\n");
        } else if let Some(err) = &o.apply_error {
            out.push_str(&format!(
                "<edits>proposed, but could not be applied: {err}</edits>\n"
            ));
        } else {
            out.push_str(&format!(
                "<edits accepted=\"{}\">\n{}\n</edits>\n",
                o.doc_after != o.doc_before,
                diff_view(&o.doc_before, &o.doc_after)
            ));
        }
        for (anchor, comment) in &o.comments {
            out.push_str(&format!(
                "<comment on=\"{}\">{}</comment>\n",
                clip(anchor, 200),
                comment
            ));
        }
        out.push_str(&format!(
            "<assistant-reply>\n{}\n</assistant-reply>\n\n",
            o.reply
        ));
    }
    out
}

/// Before/after of the changed span plus ~300 bytes either side.
pub fn diff_view(before: &str, after: &str) -> String {
    if before == after {
        return "(document unchanged)".into();
    }
    let (s, e, e2) = checks::changed_span(before, after);
    let floor = |text: &str, mut i: usize| {
        while !text.is_char_boundary(i) {
            i -= 1;
        }
        i
    };
    let ceil = |text: &str, mut i: usize| {
        while i < text.len() && !text.is_char_boundary(i) {
            i += 1;
        }
        i
    };
    let cs = floor(before, s.saturating_sub(300));
    let ce = ceil(before, (e + 300).min(before.len()));
    let ce2 = ceil(after, (e2 + 300).min(after.len()));
    format!(
        "BEFORE (changed part between ⟪ ⟫):\n{}⟪{}⟫{}\n\nAFTER:\n{}⟪{}⟫{}",
        &before[cs..s],
        &before[s..e],
        &before[e..ce],
        &after[cs..s],
        &after[s..e2],
        &after[e2..ce2]
    )
}

pub fn clip(text: &str, n: usize) -> String {
    if text.chars().count() <= n {
        text.to_string()
    } else {
        format!(
            "{}…[{} more chars]",
            text.chars().take(n).collect::<String>(),
            text.chars().count() - n
        )
    }
}

// ----------------------------------------------------------------- recorder

#[derive(Clone, Debug)]
pub struct Check {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

/// Collects named pass/fail checks for one case.
#[derive(Default)]
pub struct Checks(pub Vec<Check>);

impl Checks {
    pub fn add(&mut self, name: &str, result: Result<(), String>) {
        let (ok, detail) = match result {
            Ok(()) => (true, String::new()),
            Err(e) => (false, e),
        };
        self.0.push(Check {
            name: name.into(),
            ok,
            detail,
        });
    }
    pub fn expect(&mut self, name: &str, ok: bool, detail: impl FnOnce() -> String) {
        self.add(name, if ok { Ok(()) } else { Err(detail()) });
    }
    pub fn failed(&self) -> Vec<&Check> {
        self.0.iter().filter(|c| !c.ok).collect()
    }
}

pub struct Record {
    pub case: String,
    pub model: String,
    pub lang: String,
    pub latency_ms: u128,
    pub tokens: (u64, u64),
    pub checks: Checks,
    pub verdict: Option<Verdict>,
    pub output: Value,
}

fn run_dir() -> &'static PathBuf {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let dir = std::env::var("LEVIS_EVAL_OUT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                let stamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs();
                std::env::temp_dir()
                    .join("levis-live-eval")
                    .join(stamp.to_string())
            });
        std::fs::create_dir_all(&dir).expect("create eval output dir");
        dir
    })
}

/// Writes `<suite>.jsonl` (every case in full) and `<suite>.md` (the summary
/// table) into the run directory, prints the summary, and returns the hard
/// failures for the test to assert on. Judge scores are reported, not
/// asserted: they are the quality signal to compare run to run, while the
/// automatic checks are the contract.
pub fn finish(suite: &str, records: Vec<Record>) -> Vec<String> {
    let dir = run_dir();
    let mut jsonl = String::new();
    let mut md = format!(
        "## {suite}\n\n| case | model | lang | ms | checks | judge (min/mean) | notes |\n| --- | --- | --- | ---: | --- | --- | --- |\n"
    );
    let mut failures = Vec::new();
    let (mut passed, mut judged, mut sum_mean, mut low) = (0, 0, 0.0, 0);
    let mut by_criterion: BTreeMap<String, (f64, usize)> = BTreeMap::new();
    for r in &records {
        let failed = r.checks.failed();
        if failed.is_empty() {
            passed += 1;
        }
        for c in &failed {
            failures.push(format!(
                "{} [{}]: {} - {}",
                r.case, r.model, c.name, c.detail
            ));
        }
        let judge_cell = match &r.verdict {
            Some(v) => {
                judged += 1;
                sum_mean += v.mean().unwrap_or(0.0);
                if v.min().unwrap_or(5.0) <= 2.0 {
                    low += 1;
                }
                for (k, s) in &v.scores {
                    if let Some(s) = s {
                        let e = by_criterion.entry(k.clone()).or_default();
                        e.0 += s;
                        e.1 += 1;
                    }
                }
                format!(
                    "{:.0} / {:.1}",
                    v.min().unwrap_or(0.0),
                    v.mean().unwrap_or(0.0)
                )
            }
            None => "-".into(),
        };
        let notes: Vec<String> = failed
            .iter()
            .map(|c| format!("✗ {}: {}", c.name, clip(&c.detail, 120)))
            .chain(
                r.verdict
                    .as_ref()
                    .filter(|v| v.min().unwrap_or(5.0) < 4.0)
                    .map(|v| format!("judge: {}", clip(&v.reasons, 200))),
            )
            .collect();
        md.push_str(&format!(
            "| {} | {} | {} | {} | {}/{} | {} | {} |\n",
            r.case,
            r.model,
            r.lang,
            r.latency_ms,
            r.checks.0.len() - failed.len(),
            r.checks.0.len(),
            judge_cell,
            notes.join("<br>").replace('|', "\\|").replace('\n', " ")
        ));
        let line = json!({
            "suite": suite,
            "case": r.case,
            "model": r.model,
            "lang": r.lang,
            "latency_ms": r.latency_ms as u64,
            "input_tokens": r.tokens.0,
            "output_tokens": r.tokens.1,
            "checks": r.checks.0.iter().map(|c| json!({"name": c.name, "ok": c.ok, "detail": c.detail})).collect::<Vec<_>>(),
            "judge": r.verdict.as_ref().map(|v| json!({"scores": v.scores, "reasons": v.reasons})),
            "output": r.output,
        });
        jsonl.push_str(&line.to_string());
        jsonl.push('\n');
    }
    let n = records.len().max(1);
    let mut latencies: Vec<u128> = records.iter().map(|r| r.latency_ms).collect();
    latencies.sort();
    let median = latencies.get(latencies.len() / 2).copied().unwrap_or(0);
    md.push_str(&format!(
        "\n**{suite}**: {passed}/{} cases pass every check; judge mean {:.2} over {judged} cases, {low} with a score ≤ 2; median latency {median} ms.\n",
        records.len(),
        if judged > 0 { sum_mean / judged as f64 } else { 0.0 },
    ));
    if !by_criterion.is_empty() {
        md.push_str("\nJudge means by criterion: ");
        md.push_str(
            &by_criterion
                .iter()
                .map(|(k, (s, c))| format!("{k} {:.2}", s / *c as f64))
                .collect::<Vec<_>>()
                .join(", "),
        );
        md.push('\n');
    }
    // A spending limit or outage fails every later case the same way; say
    // so, so those rows aren't read as quality results.
    let unreached = records
        .iter()
        .filter(|r| r.checks.0.iter().any(|c| c.name == "request" && !c.ok))
        .count();
    if unreached > 0 {
        md.push_str(&format!(
            "\n**Warning: {unreached} of {n} cases never got an answer from the API** (see their `request` check) - they measure the connection or the key's limits, not the prompts.\n"
        ));
    }
    std::fs::write(dir.join(format!("{suite}.jsonl")), jsonl).expect("write jsonl");
    std::fs::write(dir.join(format!("{suite}.md")), &md).expect("write summary");
    println!("\n{md}\n[live_eval] full output: {}", dir.display());
    failures
}
