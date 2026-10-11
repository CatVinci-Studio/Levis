//! Live evaluation against the real Anthropic API: a fixed set of writing
//! tasks run through the app's own prompts and request code, with automatic
//! checks, so a prompt or model change can be compared run to run instead of
//! by feel. Every test here is `#[ignore]` - it spends money (cents per run)
//! and needs a key, so CI never runs it.
//!
//! Run from src-tauri/:
//!   cargo test --lib live_eval -- --ignored --nocapture --test-threads=1
//!
//! The key is read from $LEVIS_ANTHROPIC_KEY_FILE, else from
//! `.anthropic-api-key.local` at the repository root (git-ignored). It must
//! be a workspace-scoped key. Without one, every test prints a notice and
//! passes vacuously.

use crate::ai::agent::{build_instructions, request_context, request_user_text, MAX_STEPS};
use crate::ai::client::{completion_prompt, CompletionHints};
use crate::ai::tools::{self, ToolContext};
use crate::ai::workspace::AgentWorkspace;
use aicompat::agent::{run_agent_loop, AgentTurn, StepResult};
use aicompat::providers::anthropic::{self, AnthropicAuth, StepUsage};
use std::cell::RefCell;
use std::time::Instant;

/// What users get by default - the eval tests the shipped choice.
fn agent_model() -> &'static str {
    crate::ai::catalog::find("anthropic")
        .and_then(|e| e.agent_default_model)
        .expect("anthropic has an agent default")
}

fn auth() -> Option<AnthropicAuth> {
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

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

fn cjk_ratio(text: &str) -> f64 {
    let chars: Vec<char> = text.chars().filter(|c| !c.is_whitespace()).collect();
    if chars.is_empty() {
        return 0.0;
    }
    let cjk = chars
        .iter()
        .filter(|c| ('\u{4e00}'..='\u{9fff}').contains(*c))
        .count();
    cjk as f64 / chars.len() as f64
}

// ---------------------------------------------------------------- completion

struct CompletionCase {
    name: &'static str,
    before: &'static str,
    after: &'static str,
    title: Option<&'static str>,
    section: &'static [&'static str],
    block: &'static str,
    long: bool,
    chinese: bool,
}

const COMPLETION_CASES: &[CompletionCase] = &[
    CompletionCase {
        name: "zh mid-sentence",
        before: "城市更新不只是拆旧建新。在老城区，很多居民已经在这里生活了几十年，他们的社交网络、日常习惯和对街道的记忆，都和这些建筑紧紧连在一起。因此，规划者在制定方案时",
        after: "",
        title: Some("老城区更新的几点思考"),
        section: &["老城区更新的几点思考", "居民参与"],
        block: "paragraph",
        long: false,
        chinese: true,
    },
    CompletionCase {
        name: "zh after sentence, long",
        before: "我们在三个街区做了为期两个月的访谈，共访谈了 46 位居民。大多数受访者并不反对改造，他们真正担心的是改造期间的临时安置和改造后的租金上涨。",
        after: "",
        title: Some("老城区更新的几点思考"),
        section: &["老城区更新的几点思考", "调研发现"],
        block: "paragraph",
        long: true,
        chinese: true,
    },
    CompletionCase {
        name: "en mid-sentence",
        before: "Our first prototype stored every edit as a full copy of the document. That was simple to reason about, but on long files it quickly",
        after: "",
        title: Some("Designing the history panel"),
        section: &["Designing the history panel", "Storage"],
        block: "paragraph",
        long: false,
        chinese: false,
    },
    CompletionCase {
        name: "en list item",
        before: "Before the release we still need to:\n\n- update the screenshots in the README\n- re-run the migration on a copy of production\n- ",
        after: "",
        title: Some("Release checklist"),
        section: &["Release checklist"],
        block: "list item",
        long: false,
        chinese: false,
    },
    CompletionCase {
        name: "zh heading",
        before: "## 第三部分：",
        after: "",
        title: Some("毕业论文写作指南"),
        section: &[],
        block: "heading",
        long: false,
        chinese: true,
    },
    CompletionCase {
        name: "en long continuation",
        before: "Remote work did not kill the office; it changed what the office is for. Teams now come in to do the things that are hard over video: onboarding, planning, and resolving disagreements.",
        after: "",
        title: Some("What offices are for now"),
        section: &["What offices are for now"],
        block: "paragraph",
        long: true,
        chinese: false,
    },
];

#[test]
#[ignore = "live API - see module docs"]
fn live_completion_cases() {
    let Some(auth) = auth() else { return };
    let mut failures = Vec::new();
    for case in COMPLETION_CASES {
        let hints = CompletionHints {
            title: case.title.map(str::to_string),
            section: case.section.iter().map(|s| s.to_string()).collect(),
            block: Some(case.block.to_string()),
            length: Some(if case.long { "long" } else { "short" }.to_string()),
            candidates: None,
        };
        let (instructions, user_text) = completion_prompt(case.before, case.after, &hints, None);
        let started = Instant::now();
        let result = block_on(anthropic::call_completion(
            &auth,
            instructions,
            user_text,
            None,
        ));
        let elapsed = started.elapsed().as_millis();
        let text = match result {
            Ok(text) => text,
            Err(err) => {
                failures.push(format!("{}: request failed: {err}", case.name));
                continue;
            }
        };
        println!(
            "\n[completion] {} ({elapsed} ms)\n  before: …{}\n  output: {text:?}",
            case.name,
            tail(case.before, 30)
        );

        let mut fail = |why: String| failures.push(format!("{}: {why} -> {text:?}", case.name));
        if text.trim().is_empty() {
            fail("empty".into());
            continue;
        }
        let echo_probe = tail(case.before.trim_end(), 8);
        if echo_probe.chars().count() >= 6 && text.trim_start().starts_with(echo_probe) {
            fail("repeats the end of the before-text".into());
        }
        if case.block != "paragraph" && text.trim_end().contains('\n') {
            fail(format!("line break inside a {}", case.block));
        }
        if case.chinese && cjk_ratio(&text) < 0.5 {
            fail("not in Chinese".into());
        }
        if !case.chinese && cjk_ratio(&text) > 0.1 {
            fail("not in English".into());
        }
        let (count, max) = if case.chinese {
            (
                text.chars().filter(|c| !c.is_whitespace()).count(),
                if case.long { 220 } else { 60 },
            )
        } else {
            (
                text.split_whitespace().count(),
                if case.long { 130 } else { 40 },
            )
        };
        if count > max {
            fail(format!("too long ({count} > {max})"));
        }
    }
    assert!(
        failures.is_empty(),
        "completion failures:\n{}",
        failures.join("\n")
    );
}

fn tail(s: &str, n: usize) -> &str {
    let total = s.chars().count();
    s.char_indices()
        .nth(total.saturating_sub(n))
        .map_or(s, |(i, _)| &s[i..])
}

// --------------------------------------------------------------------- agent

struct AgentRun {
    turns: Vec<AgentTurn>,
    usage: Vec<StepUsage>,
}

impl AgentRun {
    fn calls(&self, name: &str) -> Vec<serde_json::Value> {
        self.turns
            .iter()
            .filter_map(|t| match t {
                AgentTurn::ToolCall {
                    name: n, arguments, ..
                } if n == name => serde_json::from_str(arguments).ok(),
                _ => None,
            })
            .collect()
    }

    fn accepted_edits(&self) -> Vec<serde_json::Value> {
        let mut out = Vec::new();
        for (i, turn) in self.turns.iter().enumerate() {
            if let AgentTurn::ToolCall {
                name, arguments, ..
            } = turn
            {
                let ok = matches!(self.turns.get(i + 1),
                    Some(AgentTurn::ToolResult { output, .. }) if output.starts_with("Edit proposed"));
                if name == "propose_edit" && ok {
                    out.extend(serde_json::from_str(arguments).ok());
                }
            }
        }
        out
    }

    fn reply(&self) -> String {
        match self.turns.last() {
            Some(AgentTurn::Assistant { text }) => text.clone(),
            _ => String::new(),
        }
    }

    fn print(&self, label: &str) {
        println!("\n[agent] {label}");
        for turn in &self.turns {
            match turn {
                AgentTurn::User { text, .. } => println!("  user: {}", tail(text, 120)),
                AgentTurn::ToolCall {
                    name, arguments, ..
                } => {
                    println!("  call {name}: {}", truncate(arguments, 220))
                }
                AgentTurn::ToolResult { output, .. } => {
                    println!("  result: {}", truncate(output, 120))
                }
                AgentTurn::Assistant { text } => println!("  reply: {}", truncate(text, 300)),
            }
        }
        for (i, u) in self.usage.iter().enumerate() {
            println!(
                "  step {}: in {} (cache write {}, cache read {}), out {}",
                i + 1,
                u.input_tokens,
                u.cache_creation_input_tokens,
                u.cache_read_input_tokens,
                u.output_tokens
            );
        }
    }
}

fn truncate(s: &str, n: usize) -> String {
    let flat = s.replace('\n', "⏎");
    if flat.chars().count() <= n {
        flat
    } else {
        format!("{}…", flat.chars().take(n).collect::<String>())
    }
}

fn run_agent(
    auth: &AnthropicAuth,
    model: &str,
    document: &str,
    message: &str,
) -> Result<AgentRun, String> {
    run_agent_with(
        auth,
        model,
        document,
        message,
        "edit",
        &AgentWorkspace::default(),
    )
}

fn run_agent_with(
    auth: &AnthropicAuth,
    model: &str,
    document: &str,
    message: &str,
    mode: &str,
    workspace: &AgentWorkspace,
) -> Result<AgentRun, String> {
    let instructions = build_instructions(workspace, document, true, mode, message);
    let tool_set = tools::builtin_tools(false, false, mode == "edit");
    let specs = tools::tool_specs(&tool_set);
    let ctx = ToolContext {
        document,
        skills: &[],
        root: None,
    };
    let usage = RefCell::new(Vec::new());
    let turns = block_on(run_agent_loop(
        Vec::new(),
        AgentTurn::User {
            text: request_user_text(
                &request_context(workspace, document, true, message, None),
                message,
            ),
            images: Vec::new(),
        },
        MAX_STEPS,
        |history: Vec<AgentTurn>| {
            let (instructions, specs, usage) = (&instructions, &specs, &usage);
            async move {
                let (step, used): (StepResult, StepUsage) = anthropic::agent_step_with_usage(
                    auth,
                    instructions,
                    &history,
                    specs,
                    false,
                    model,
                    &|_| {},
                )
                .await?;
                usage.borrow_mut().push(used);
                Ok(step)
            }
        },
        |name, args| tools::execute(&tool_set, &ctx, name, args),
        |_| {},
    ))?;
    Ok(AgentRun {
        turns,
        usage: usage.into_inner(),
    })
}

const ZH_DOC: &str = "# 老城区更新的几点思考\n\n城市更新不只是拆旧建新。在老城区，很多居民已经在这里生活了几十年。\n\n这项研究在三个街区进行，我们花了整整两个月的时间，和住在这些街区里的居民进行了一对一的、比较深入的访谈，一共访谈了四十六位居民，访谈的内容涵盖了他们对改造的看法、担忧以及期待等多个方面。\n\n大多数受访者并不反对改造，他们真正担心的是临时安置和租金上涨。\n";

#[test]
#[ignore = "live API - see module docs"]
fn live_agent_shortens_a_paragraph() {
    let Some(auth) = auth() else { return };
    let run = run_agent(&auth, agent_model(), ZH_DOC, "把第二段改得更简洁一些。").unwrap();
    run.print("zh: shorten the second paragraph");
    let edits = run.accepted_edits();
    assert!(!edits.is_empty(), "no valid propose_edit");
    let edit = &edits[0];
    let anchor = edit["anchor"].as_str().unwrap_or_default();
    let text = edit["text"].as_str().unwrap_or_default();
    assert!(
        anchor.contains("访谈") || edit["action"] == "replace_selection",
        "edited the wrong paragraph: {anchor}"
    );
    assert!(text.chars().count() < anchor.chars().count(), "not shorter");
    assert!(cjk_ratio(text) > 0.5, "not Chinese");
    assert!(!run.reply().trim().is_empty(), "no closing reply");
}

#[test]
#[ignore = "live API - see module docs"]
fn live_agent_inserts_inside_a_sentence() {
    let Some(auth) = auth() else { return };
    let run = run_agent(
        &auth,
        agent_model(),
        ZH_DOC,
        "在“这项研究”后面补充“（2024 年）”。",
    )
    .unwrap();
    run.print("zh: insert inside a sentence");
    let edits = run.accepted_edits();
    assert!(!edits.is_empty(), "no valid propose_edit");
    let edit = &edits[0];
    let text = edit["text"].as_str().unwrap_or_default();
    assert!(text.contains("2024"), "lost the inserted text: {edit}");
    // Either a precise insert_after on the phrase, or a replace that keeps
    // the sentence intact - but never a new paragraph.
    assert!(
        !text.contains("\n\n"),
        "turned the insertion into a paragraph: {edit}"
    );
}

#[test]
#[ignore = "live API - see module docs"]
fn live_agent_answers_questions_without_editing() {
    let Some(auth) = auth() else { return };
    let run = run_agent(&auth, agent_model(), ZH_DOC, "这篇文章的主要发现是什么？").unwrap();
    run.print("zh: question, no edit");
    assert!(
        run.calls("propose_edit").is_empty(),
        "edited the document for a question"
    );
    assert!(
        cjk_ratio(&run.reply()) > 0.3,
        "reply not in Chinese: {}",
        run.reply()
    );
}

/// About 60k characters, past the full-document limit, so the model only
/// sees the outline and has to read the section it is asked about.
fn long_doc() -> String {
    let topics = [
        "Sampling",
        "Instruments",
        "Interviews",
        "Coding",
        "Validity",
        "Ethics",
    ];
    let mut doc = String::from("# Field study report\n\n");
    for (s, topic) in topics.iter().enumerate() {
        doc.push_str(&format!("## {topic}\n\n"));
        for p in 0..14 {
            let mut para = String::new();
            for k in 0..9 {
                para.push_str(&format!(
                    "In {topic} block {p}, observation {k} noted that site {} reported {} visits over the season, which the team cross-checked against the logbook. ",
                    (s * 31 + p * 7 + k) % 97,
                    (s * 13 + p * 5 + k * 3) % 400
                ));
            }
            doc.push_str(para.trim_end());
            doc.push_str("\n\n");
        }
    }
    doc
}

#[test]
#[ignore = "live API - see module docs"]
fn live_agent_edits_a_section_of_a_long_document() {
    let Some(auth) = auth() else { return };
    let doc = long_doc();
    assert!(doc.chars().count() > 40_000);
    let run = run_agent(
        &auth,
        agent_model(),
        &doc,
        "Tighten the first paragraph of the 'Coding' section: same facts, fewer words.",
    )
    .unwrap();
    run.print("en: long document, edit one section");
    assert!(
        !run.calls("read_document").is_empty() || !run.calls("search_document").is_empty(),
        "edited without looking at the section"
    );
    let edits = run.accepted_edits();
    assert!(!edits.is_empty(), "no valid propose_edit");
    assert!(
        edits[0]["anchor"]
            .as_str()
            .unwrap_or_default()
            .contains("In Coding block 0"),
        "edited the wrong paragraph"
    );
    // Prompt caching: every step after the first re-reads the shared prefix.
    if run.usage.len() > 1 {
        let reads: u64 = run.usage[1..]
            .iter()
            .map(|u| u.cache_read_input_tokens)
            .sum();
        assert!(reads > 0, "no cache reads across {} steps", run.usage.len());
    }
}

#[test]
#[ignore = "live API - see module docs"]
fn live_completion_returns_distinct_candidates() {
    let Some(auth) = auth() else { return };
    let hints = CompletionHints {
        title: Some("老城区更新的几点思考".into()),
        section: vec!["调研发现".into()],
        block: Some("paragraph".into()),
        length: Some("long".into()),
        candidates: Some(3),
    };
    let before = "大多数受访者并不反对改造，他们真正担心的是改造期间的临时安置和改造后的租金上涨。";
    let (instructions, user_text) = completion_prompt(before, "", &hints, None);
    let raw = block_on(anthropic::call_completion(
        &auth,
        instructions,
        user_text,
        None,
    ))
    .unwrap();
    let parts: Vec<&str> = raw
        .split(crate::ai::client::CANDIDATE_SEPARATOR)
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();
    println!("\n[completion] candidates:");
    for p in &parts {
        println!("  - {p}");
    }
    assert!(parts.len() >= 2, "expected several candidates, got {raw:?}");
    assert!(parts.iter().all(|p| cjk_ratio(p) > 0.5));
    assert_ne!(parts[0], parts[1]);
}

#[test]
#[ignore = "live API - see module docs"]
fn live_agent_reviews_with_comments_not_edits() {
    let Some(auth) = auth() else { return };
    let run = run_agent_with(
        &auth,
        agent_model(),
        ZH_DOC,
        "帮我看看这篇文章哪里写得不好，指出具体的段落。",
        "ask",
        &AgentWorkspace::default(),
    )
    .unwrap();
    run.print("zh: review in ask mode -> comments");
    assert!(run.calls("propose_edit").is_empty());
    assert!(
        !run.calls("add_comment").is_empty(),
        "expected add_comment calls"
    );
    let ok = run
        .turns
        .iter()
        .filter(|t| matches!(t, AgentTurn::ToolResult { output, .. } if output.starts_with("Comment added")))
        .count();
    assert!(ok >= 1, "no comment validated against the document");
}

/// Mirrors src/ai/chat/user-message.ts's cursorBlock.
fn cursor_block(before: &str, after: &str) -> String {
    format!("<cursor>\n{before}⟦cursor⟧{after}\n</cursor>")
}

#[test]
#[ignore = "live API - see module docs"]
fn live_agent_inserts_at_the_cursor() {
    let Some(auth) = auth() else { return };
    let message = format!(
        "{}\n\n在这里补一句过渡，引出下一段。",
        cursor_block(
            "访谈的内容涵盖了他们对改造的看法、担忧以及期待等多个方面。",
            "\n\n大多数受访者并不反对改造"
        )
    );
    let run = run_agent(&auth, agent_model(), ZH_DOC, &message).unwrap();
    run.print("zh: insert at cursor");
    let edits = run.accepted_edits();
    assert!(!edits.is_empty(), "no valid propose_edit");
    assert!(
        edits
            .iter()
            .any(|e| e["action"] == "insert_at_cursor" || e["action"] == "insert_after"),
        "expected an insertion at the cursor: {edits:?}"
    );
}

#[test]
#[ignore = "live API - see module docs"]
fn live_agent_uses_the_project_library() {
    let Some(auth) = auth() else { return };
    let workspace = AgentWorkspace {
        library: vec![crate::ai::project::parse_library_entry(
            ".levis/library/lin.md",
            "lin",
            "---\nname: 林晚\naliases: [晚晚]\n---\n林晚是中学语文老师，三十二岁，从不喝咖啡。",
        )],
        ..AgentWorkspace::default()
    };
    let run = run_agent_with(
        &auth,
        agent_model(),
        "# 第一章\n\n晚晚推开教室的门。",
        "晚晚是做什么工作的？用一句话回答。",
        "ask",
        &workspace,
    )
    .unwrap();
    run.print("zh: library fact");
    assert!(
        run.reply().contains("语文"),
        "library fact not used: {}",
        run.reply()
    );
}

/// Free: lists models through the app's own paging and tidying.
#[test]
#[ignore = "live API - see module docs"]
fn live_lists_every_model() {
    let Some(auth) = auth() else { return };
    let models = block_on(anthropic::list_models(&auth)).unwrap();
    println!("\n[models] {} listed: {}", models.len(), models.join(", "));
    assert!(models.iter().any(|m| m == anthropic::COMPLETION_MODEL));
    assert!(models.iter().any(|m| m == agent_model()));
}
