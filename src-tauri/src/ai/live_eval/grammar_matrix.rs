//! The grammar matrix: each strictness level on real mistakes, on clean text
//! (where any report is a false positive), and on text full of things that
//! must be left alone - code, URLs, math, names. The paragraph is what the
//! editor sends: the block's textContent, so inline code arrives without
//! its backticks and a link as its visible text.

use super::checks::{self, Lang};
use super::harness::{self, Checks, Record};
use crate::ai::client::{grammar_instructions, parse_grammar_reply, GrammarIssue};
use aicompat::providers::anthropic::AnthropicAuth;
use serde_json::json;

pub struct GrammarCase {
    pub id: &'static str,
    pub lang: Lang,
    pub strictness: &'static str,
    pub paragraph: &'static str,
    /// (the wrong text, what the corrected paragraph must then contain).
    pub fixes: &'static [(&'static str, &'static str)],
    /// Spans no issue may touch.
    pub protected: &'static [&'static str],
    /// Most issues allowed beyond `fixes` (0 = no false positives at all).
    pub extra: usize,
}

pub const CASES: &[GrammarCase] = &[
    GrammarCase { id: "en/typos/standard", lang: Lang::En, strictness: "standard", paragraph: "The commitee will recieve the final report on Friday, and then it will decide wether to fund the second phase.", fixes: &[("commitee", "committee"), ("recieve", "receive"), ("wether", "whether")], protected: &[], extra: 0 },
    GrammarCase { id: "en/grammar/standard", lang: Lang::En, strictness: "standard", paragraph: "Each of the participants have their own reasons for joining, and the results of the survey was surprising to all of us.", fixes: &[("have", "has"), ("was", "were")], protected: &[], extra: 0 },
    GrammarCase { id: "en/clean/standard", lang: Lang::En, strictness: "standard", paragraph: "The library opened a second reading room in March. Since then, weekday attendance has nearly doubled, and the waiting list for study desks has disappeared.", fixes: &[], protected: &[], extra: 0 },
    GrammarCase { id: "en/clean/typos", lang: Lang::En, strictness: "typos", paragraph: "We shipped the release on Tuesday. Nobody noticed the new icon, which is probably the best compliment a redesign can get.", fixes: &[], protected: &[], extra: 0 },
    GrammarCase { id: "en/clean/strict", lang: Lang::En, strictness: "strict", paragraph: "The library opened a second reading room in March. Since then, weekday attendance has nearly doubled, and the waiting list for study desks has disappeared.", fixes: &[], protected: &[], extra: 1 },
    GrammarCase { id: "en/code-url-math/standard", lang: Lang::En, strictness: "standard", paragraph: "Run npm install, then open http://localhost:1430/docs to check that the the value of x^2 + y^2 is shown; the tsconfig.json file controls this.", fixes: &[("the the", "check that the value")], protected: &["npm install", "http://localhost:1430/docs", "x^2 + y^2", "tsconfig.json"], extra: 0 },
    GrammarCase { id: "en/names/standard", lang: Lang::En, strictness: "standard", paragraph: "Ayşe and Siobhan met the Tauri maintainers at RustConf in Montréal, where they demoed Levis on a Pinebook.", fixes: &[], protected: &["Ayşe", "Siobhan", "Tauri", "RustConf", "Montréal", "Levis", "Pinebook"], extra: 0 },
    GrammarCase { id: "en/typos-only-ignores-grammar", lang: Lang::En, strictness: "typos", paragraph: "She go to the libary every weekend because it is quiet there.", fixes: &[("libary", "library")], protected: &["go"], extra: 0 },
    GrammarCase { id: "en/wordy/strict", lang: Lang::En, strictness: "strict", paragraph: "In my personal opinion, the end result of the project was the fact that the team became more closer to each other.", fixes: &[("more closer", "closer")], protected: &[], extra: 3 },
    GrammarCase { id: "en/wordy/standard", lang: Lang::En, strictness: "standard", paragraph: "In my personal opinion, the end result of the project was that the team grew closer.", fixes: &[], protected: &[], extra: 0 },
    GrammarCase { id: "en/dialogue/standard", lang: Lang::En, strictness: "standard", paragraph: "\"Ain't nobody got time for that,\" Grandpa said, and went back to his crossword.", fixes: &[], protected: &["Ain't nobody got time for that"], extra: 0 },
    GrammarCase { id: "zh/typo/standard", lang: Lang::ZhHans, strictness: "standard", paragraph: "我们在会议上讨论了这个问题，大家一至认为应该尽快解决，不然会影响下个月的进度。", fixes: &[("一至", "一致")], protected: &[], extra: 0 },
    GrammarCase { id: "zh/de-di-de/standard", lang: Lang::ZhHans, strictness: "standard", paragraph: "听到这个消息，他高兴的跳了起来，跑得比谁都快。", fixes: &[("高兴的跳", "高兴地跳")], protected: &["跑得"], extra: 0 },
    GrammarCase { id: "zh/clean/standard", lang: Lang::ZhHans, strictness: "standard", paragraph: "市图书馆在一月份启动了周末读书会。一年下来，注册参与者从 120 人增长到 310 人，周日闭馆太早是大家最常提到的问题。", fixes: &[], protected: &["120", "310"], extra: 0 },
    GrammarCase { id: "zh/clean/strict", lang: Lang::ZhHans, strictness: "strict", paragraph: "市图书馆在一月份启动了周末读书会。一年下来，注册参与者从 120 人增长到 310 人，周日闭馆太早是大家最常提到的问题。", fixes: &[], protected: &["120", "310"], extra: 1 },
    GrammarCase { id: "zh/mixed-terms/standard", lang: Lang::Mixed, strictness: "standard", paragraph: "我们用 Tauri 重写了 editor，安装包从 180 MB 降到了 12 MB，冷启动也块了很多。", fixes: &[("块了", "快了")], protected: &["Tauri", "editor", "180 MB", "12 MB"], extra: 0 },
    GrammarCase { id: "zh-Hant/wrong-script/standard", lang: Lang::ZhHant, strictness: "standard", paragraph: "我們明天要去圖書館借書。他的作業寫得很好，老師很满意。", fixes: &[("满意", "滿意")], protected: &[], extra: 0 },
    GrammarCase { id: "ja/typo/standard", lang: Lang::Ja, strictness: "standard", paragraph: "昨日は友達と映画を見に行きました。とても面白かったでしだ。", fixes: &[("でしだ", "でした")], protected: &[], extra: 0 },
    GrammarCase { id: "ja/clean/standard", lang: Lang::Ja, strictness: "standard", paragraph: "市立図書館は一月に週末読書クラブを始めました。登録参加者は一年で120人から310人に増えました。", fixes: &[], protected: &[], extra: 0 },
    GrammarCase { id: "ko/typo/standard", lang: Lang::Ko, strictness: "standard", paragraph: "저는 어제 오랜만에 친구를 만낫어요. 같이 저녁을 먹고 산책을 했어요.", fixes: &[("만낫어요", "만났어요")], protected: &[], extra: 0 },
    GrammarCase { id: "es/accent/standard", lang: Lang::Es, strictness: "standard", paragraph: "Ayer fuimos a la playa y nos divertimos mucho, aunque hacia demasiado calor para quedarnos toda la tarde.", fixes: &[("hacia", "hacía")], protected: &[], extra: 0 },
    GrammarCase { id: "fr/agreement/standard", lang: Lang::Fr, strictness: "standard", paragraph: "Les enfants sont allé au parc hier après-midi, puis ils ont goûté chez leur grand-mère.", fixes: &[("allé", "allés")], protected: &[], extra: 0 },
    GrammarCase { id: "de/participle/standard", lang: Lang::De, strictness: "standard", paragraph: "Wir haben das Buch im Urlaub gelest und danach lange darüber gesprochen.", fixes: &[("gelest", "gelesen")], protected: &[], extra: 0 },
    GrammarCase { id: "de/clean/standard", lang: Lang::De, strictness: "standard", paragraph: "Die Stadtbibliothek hat im Januar einen Leseclub gegründet, und seitdem kommen deutlich mehr Jugendliche am Wochenende.", fixes: &[], protected: &[], extra: 0 },
    GrammarCase { id: "ru/case/standard", lang: Lang::Ru, strictness: "standard", paragraph: "Вчера я ходил в магазин и купил хлеб, молоко и яйцы.", fixes: &[("яйцы", "яйца")], protected: &[], extra: 0 },
    GrammarCase { id: "pt/agreement/standard", lang: Lang::Pt, strictness: "standard", paragraph: "Amanhã nós vai ao cinema com os meus primos.", fixes: &[("vai", "vamos")], protected: &[], extra: 0 },
];

pub fn all_cases() -> Vec<&'static GrammarCase> {
    CASES.iter().filter(|c| harness::selected(c.id)).collect()
}

/// The paragraph with every issue applied, back to front - what accepting
/// all suggestions produces.
fn apply(paragraph: &str, issues: &[GrammarIssue]) -> Result<String, String> {
    let mut chars: Vec<char> = paragraph.chars().collect();
    let mut sorted: Vec<&GrammarIssue> = issues.iter().collect();
    sorted.sort_by_key(|i| i.start);
    for pair in sorted.windows(2) {
        if pair[1].start < pair[0].end {
            return Err("overlapping issues".into());
        }
    }
    for issue in sorted.into_iter().rev() {
        chars.splice(issue.start..issue.end, issue.suggestion.chars());
    }
    Ok(chars.into_iter().collect())
}

fn span_text(paragraph: &str, issue: &GrammarIssue) -> String {
    paragraph
        .chars()
        .skip(issue.start)
        .take(issue.end - issue.start)
        .collect()
}

pub fn run_case(auth: &AnthropicAuth, case: &GrammarCase, model: &str) -> Record {
    let mut checks = Checks::default();
    let instructions = grammar_instructions(Some(case.strictness));
    // Two attempts, as ai_grammar_check makes on a malformed reply.
    let (mut raw, mut latency, mut parsed) = (String::new(), 0, Err(String::new()));
    for _ in 0..2 {
        match harness::complete(
            auth,
            &instructions,
            case.paragraph,
            harness::writing_model_arg(model),
        ) {
            Ok((text, ms)) => {
                latency += ms;
                parsed = parse_grammar_reply(&text, case.paragraph);
                raw = text;
            }
            Err(e) => {
                checks.add("request", Err(e));
                break;
            }
        }
        if parsed.is_ok() {
            break;
        }
    }
    let issues = match parsed {
        Ok(issues) => issues,
        Err(e) => {
            if !raw.is_empty() {
                checks.add("parses", Err(e));
            }
            Vec::new()
        }
    };
    let corrected = apply(case.paragraph, &issues);
    checks.add(
        "applies cleanly",
        corrected.as_ref().map(|_| ()).map_err(Clone::clone),
    );
    let corrected = corrected.unwrap_or_default();
    for (wrong, fix) in case.fixes {
        // Any issue overlapping the mistake counts - flagging just 的 in
        // 高兴的跳 is the ideal minimal span.
        let at = case
            .paragraph
            .find(wrong)
            .map(|b| case.paragraph[..b].chars().count())
            .expect("case error: mistake not in paragraph");
        let end = at + wrong.chars().count();
        let flagged = issues.iter().any(|i| i.start < end && i.end > at);
        checks.expect(&format!("flags {wrong:?}"), flagged, || {
            "not reported".into()
        });
        checks.expect(
            &format!("fix gives {fix:?}"),
            corrected.contains(fix),
            || format!("corrected: {corrected}"),
        );
    }
    // Issues that touch none of the known mistakes.
    let extra = issues
        .iter()
        .filter(|i| {
            !case.fixes.iter().any(|(wrong, _)| {
                let at = case
                    .paragraph
                    .find(wrong)
                    .map_or(0, |b| case.paragraph[..b].chars().count());
                i.start < at + wrong.chars().count() && i.end > at
            })
        })
        .count();
    checks.expect("no false positives", extra <= case.extra, || {
        format!(
            "{extra} extra issue(s): {}",
            issues
                .iter()
                .map(|i| format!("{:?}->{:?}", span_text(case.paragraph, i), i.suggestion))
                .collect::<Vec<_>>()
                .join("; ")
        )
    });
    for p in case.protected {
        let start = case
            .paragraph
            .find(p)
            .map(|b| case.paragraph[..b].chars().count());
        if let Some(start) = start {
            let end = start + p.chars().count();
            let touched = issues.iter().any(|i| i.start < end && i.end > start);
            checks.expect(&format!("leaves {p:?} alone"), !touched, || {
                "flagged a protected span".into()
            });
        }
    }
    let descriptions: String = issues.iter().map(|i| format!("{} ", i.issue)).collect();
    if checks::word_count(&descriptions) >= 6 && case.lang != Lang::Mixed {
        checks.add(
            "issue language",
            checks::check_lang(&descriptions, case.lang),
        );
    }

    let verdict = harness::judge(
        auth,
        &format!("A grammar checker in a Markdown editor reviewed one paragraph at strictness '{}' and returned issues the user can apply with one click.", case.strictness),
        &format!("Strictness scope: {}. Map the criteria as: helpfulness = recall (real mistakes in scope caught); faithfulness = precision (nothing correct flagged, no taste presented as an error, code/URLs/math/names/dialogue left alone); minimality = spans as small as possible; tone = issue descriptions natural and in the paragraph's language; correctness = each suggestion is right and reads correctly in place. Known mistakes in this paragraph: {}.", match case.strictness { "typos" => "only unambiguous typos and misspellings", "strict" => "typos, grammar, plus redundancy and unclear phrasing", _ => "typos and clear grammar mistakes, no style" }, if case.fixes.is_empty() { "none - the paragraph is correct".to_string() } else { case.fixes.iter().map(|(w, f)| format!("{w} -> {f}")).collect::<Vec<_>>().join(", ") }),
        &format!("<paragraph>{}</paragraph>\n\n<issues>\n{}\n</issues>\n\n<paragraph-after-applying-all>{corrected}</paragraph-after-applying-all>", case.paragraph, if issues.is_empty() { "(none)".to_string() } else { issues.iter().map(|i| format!("- {:?} -> {:?}: {}", span_text(case.paragraph, i), i.suggestion, i.issue)).collect::<Vec<_>>().join("\n") }),
    );
    Record {
        case: case.id.to_string(),
        model: model.to_string(),
        lang: case.lang.code().into(),
        latency_ms: latency,
        tokens: (0, 0),
        checks,
        verdict,
        output: json!({"raw": raw, "issues": issues, "corrected": corrected}),
    }
}
