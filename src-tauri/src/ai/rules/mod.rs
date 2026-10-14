//! The deterministic writing-rules engine: the mechanical conventions of
//! the ten document languages, checked and fixed in code instead of being
//! left to a model that can't count characters or see a half-width comma
//! (CATALOGUE.md §3, decisions 5-6).
//!
//! - [`check`]: one paragraph's plain text, as the grammar check receives
//!   it - merged with the model's issues in `client::finish_grammar`.
//! - [`check_document`]: a whole Markdown document (code, math, front
//!   matter, link targets and HTML skipped), with the document-level and
//!   consistency rules - the `check_conventions` agent tool.
//! - [`postfix`]: the safe subsets applied to completions (CP) and to the
//!   text of edit proposals (PR), only where the document already follows
//!   the convention.
//! - [`measure`]: exact platform counts for the `measure_text` tool.
//!
//! Every rule has an id (`zh.punct.halfwidth`) and an entry in
//! [`registry`] with its priority: P0 runs at the "standard" grammar level
//! and its fix is safe; P1 runs at "standard" as one-by-one suggestions; P2
//! only at "strict", under a profile the user chose, or as document-level
//! consistency info. The "typos" level runs only spelling rules. Messages
//! are in the language of the text the rule fires on.

pub mod detect;
pub(crate) mod document;
pub mod measure;
mod messages;
pub mod postfix;
pub mod profile;
pub(crate) mod registry;
mod stats;
pub(crate) mod text;

mod de;
mod en;
mod es;
mod fr;
mod ja;
mod ko;
mod pt;
mod ru;
mod shared;
mod tw;
mod zh;
mod zhdata;

pub use detect::Lang;
pub use document::{check_document, DocReport};
pub use profile::{Conventions, Profile, ProjectConventions};
pub(crate) use stats::Stats;

use registry::{Category, RuleInfo};
use serde::Serialize;
use text::Text;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

/// What can be done with a finding's suggestion.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Fix {
    /// Safe to apply without review ("fix all", post-processing).
    Safe,
    /// A suggestion to review one by one.
    Suggest,
    /// Nothing to apply: the finding only flags.
    None,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority {
    P0,
    P1,
    P2,
}

/// The grammar check's strictness setting (grammarStrictness).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Typos,
    Standard,
    Strict,
}

impl Level {
    pub fn from_setting(value: Option<&str>) -> Level {
        match value {
            Some("typos") => Level::Typos,
            Some("strict") => Level::Strict,
            _ => Level::Standard,
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Finding {
    pub rule: &'static str,
    /// Unicode-scalar offsets into the checked text (the paragraph for
    /// [`check`], the Markdown source for [`check_document`]).
    pub start: usize,
    pub end: usize,
    pub original: String,
    pub suggestion: Option<String>,
    pub severity: Severity,
    pub fix: Fix,
    pub priority: Priority,
    pub message: String,
    /// 1-based line in the document ([`check_document`] only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
}

impl Finding {
    pub fn info(&self) -> &'static RuleInfo {
        registry::info(self.rule)
    }
}

/// What kind of block a text is - some rules apply only to headings, some
/// skip lists, quotations or table cells.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Block {
    Paragraph,
    Heading(u8),
    ListItem,
    Quote,
    TableCell,
    /// A paragraph from the grammar check: no Markdown context.
    Unknown,
}

impl Block {
    pub fn is_heading(self) -> bool {
        matches!(self, Block::Heading(_))
    }
}

/// What a rule knows besides the text.
pub(crate) struct Ctx<'a> {
    pub lang: Lang,
    pub profile: &'a Profile,
    /// Convention counts for the document (or, in the grammar check, the
    /// paragraph): what "the document's own majority" means.
    pub stats: &'a Stats,
    pub block: Block,
    /// Library names and aliases (the project's people, places, terms).
    pub library: &'a [String],
}

/// Collects a rule's findings, dropping any that touch a protected span.
pub(crate) struct Out<'a> {
    t: &'a Text,
    pub found: Vec<Finding>,
}

impl<'a> Out<'a> {
    pub fn new(t: &'a Text) -> Self {
        Out {
            t,
            found: Vec::new(),
        }
    }

    pub fn add(
        &mut self,
        rule: &'static str,
        start: usize,
        end: usize,
        suggestion: Option<String>,
        message: impl Into<String>,
    ) {
        if start >= end || end > self.t.len() || self.t.guarded(start, end) {
            return;
        }
        let original = self.t.slice(start, end);
        if suggestion.as_deref() == Some(original.as_str()) {
            return;
        }
        let info = registry::info(rule);
        self.found.push(Finding {
            rule,
            start,
            end,
            original,
            suggestion,
            severity: info.severity,
            fix: info.fix,
            priority: info.priority,
            message: message.into(),
            line: None,
        });
    }

    /// A finding with a replacement.
    pub fn fix(
        &mut self,
        rule: &'static str,
        start: usize,
        end: usize,
        to: impl Into<String>,
        message: impl Into<String>,
    ) {
        self.add(rule, start, end, Some(to.into()), message);
    }

    /// A finding that only flags.
    pub fn flag(
        &mut self,
        rule: &'static str,
        start: usize,
        end: usize,
        message: impl Into<String>,
    ) {
        self.add(rule, start, end, None, message);
    }
}

/// Runs every rule for `ctx.lang` over one block.
pub(crate) fn run_rules(t: &Text, ctx: &Ctx, out: &mut Out) {
    shared::run(t, ctx, out);
    match ctx.lang {
        Lang::ZhHans | Lang::ZhHant => zh::run(t, ctx, out),
        Lang::En => en::run(t, ctx, out),
        Lang::Ja => ja::run(t, ctx, out),
        Lang::Ko => ko::run(t, ctx, out),
        Lang::Es => es::run(t, ctx, out),
        Lang::Fr => fr::run(t, ctx, out),
        Lang::De => de::run(t, ctx, out),
        Lang::Ru => ru::run(t, ctx, out),
        Lang::Pt => pt::run(t, ctx, out),
    }
}

/// Whether a rule runs at `level`. Document-level consistency info runs at
/// "standard" too, and so do rules gated on a profile the user chose.
pub(crate) fn allowed(info: &RuleInfo, level: Level, doc_level: bool) -> bool {
    match level {
        Level::Typos => info.category == Category::Spelling && info.priority != Priority::P2,
        Level::Standard => {
            info.priority != Priority::P2
                || info.gated
                || (doc_level && info.category == Category::Consistency)
        }
        Level::Strict => true,
    }
}

/// Sorted by position; of two findings that would both rewrite the same
/// characters, the one with the higher priority (then the earlier one)
/// stays. Flag-only findings never block a fix.
pub(crate) fn tidy(mut found: Vec<Finding>) -> Vec<Finding> {
    found.sort_by_key(|f| (f.start, f.priority, f.end));
    let mut kept: Vec<Finding> = Vec::new();
    for f in found {
        let clash = f.suggestion.is_some()
            && kept.iter().any(|k| {
                k.suggestion.is_some()
                    && k.start < f.end.max(f.start + 1)
                    && f.start < k.end.max(k.start + 1)
            });
        let same = kept
            .iter()
            .any(|k| k.rule == f.rule && k.start == f.start && k.end == f.end);
        if !clash && !same {
            kept.push(f);
        }
    }
    kept
}

/// One paragraph's findings for the grammar check: the language detected
/// from the text, the profile from `conv`, and only the rules that run in
/// the grammar check at `level`.
pub fn check(text: &str, conv: &Conventions, level: Level, library: &[String]) -> Vec<Finding> {
    check_as(
        text,
        detect::guess(text),
        conv,
        level,
        library,
        registry::GC,
    )
}

pub(crate) fn check_as(
    text: &str,
    lang: Option<Lang>,
    conv: &Conventions,
    level: Level,
    library: &[String],
    site: u8,
) -> Vec<Finding> {
    let t = Text::new(text);
    let Some(lang) = lang else {
        // Too short to tell the language: only what holds in every one.
        let profile = Profile::automatic(Lang::En);
        let stats = Stats::default();
        let ctx = Ctx {
            lang: Lang::En,
            profile: &profile,
            stats: &stats,
            block: Block::Unknown,
            library,
        };
        let mut out = Out::new(&t);
        shared::nfc(&t, &ctx, &mut out);
        shared::double_space(&t, &ctx, &mut out);
        return finish(out.found, level, site, false);
    };
    let profile = conv.profile_for(lang);
    let mut stats = Stats::default();
    stats.count(&t, lang);
    let ctx = Ctx {
        lang,
        profile: &profile,
        stats: &stats,
        block: Block::Unknown,
        library,
    };
    let mut out = Out::new(&t);
    run_rules(&t, &ctx, &mut out);
    finish(out.found, level, site, false)
}

pub(crate) fn finish(found: Vec<Finding>, level: Level, site: u8, doc_level: bool) -> Vec<Finding> {
    tidy(
        found
            .into_iter()
            .filter(|f| {
                let info = f.info();
                info.sites & site != 0 && allowed(info, level, doc_level)
            })
            .collect(),
    )
}

/// Applies the findings' suggestions to `text` (char offsets), skipping
/// any that overlap one already applied.
pub fn apply(text: &str, findings: &[Finding]) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut fixes: Vec<&Finding> = findings
        .iter()
        .filter(|f| f.suggestion.is_some() && f.end <= chars.len())
        .collect();
    fixes.sort_by_key(|f| f.start);
    let mut out = String::new();
    let mut at = 0;
    for f in fixes {
        if f.start < at {
            continue;
        }
        out.extend(&chars[at..f.start]);
        out.push_str(f.suggestion.as_deref().unwrap_or_default());
        at = f.end;
    }
    out.extend(&chars[at..]);
    out
}

#[cfg(test)]
pub(crate) mod testing {
    //! Helpers for the per-language rule tests.
    use super::*;

    /// Findings of `rule` on `text` read as `lang` under `profile` (or
    /// Automatic), at every level, as (original, suggestion) pairs.
    pub fn hits(
        rule: &str,
        lang: Lang,
        profile: Option<&str>,
        text: &str,
    ) -> Vec<(String, Option<String>)> {
        hits_in(rule, lang, profile, text, Block::Unknown)
    }

    pub fn hits_in(
        rule: &str,
        lang: Lang,
        profile: Option<&str>,
        text: &str,
        block: Block,
    ) -> Vec<(String, Option<String>)> {
        findings(lang, profile, text, block)
            .into_iter()
            .filter(|f| f.rule == rule)
            .map(|f| (f.original, f.suggestion))
            .collect()
    }

    pub fn findings(lang: Lang, profile: Option<&str>, text: &str, block: Block) -> Vec<Finding> {
        let conv = Conventions {
            setting: profile.map(|p| serde_json::json!({ lang.code(): p })),
            ..Default::default()
        };
        let t = Text::new(text);
        let profile = conv.profile_for(lang);
        let mut stats = Stats::default();
        stats.count(&t, lang);
        let library = ["Elizabeth".to_string(), "林黛玉".to_string()];
        let ctx = Ctx {
            lang,
            profile: &profile,
            stats: &stats,
            block,
            library: &library,
        };
        let mut out = Out::new(&t);
        run_rules(&t, &ctx, &mut out);
        out.found
    }

    /// `text` with every fix of `rule` applied.
    pub fn fixed(rule: &str, lang: Lang, profile: Option<&str>, text: &str) -> String {
        let found: Vec<Finding> = findings(lang, profile, text, Block::Unknown)
            .into_iter()
            .filter(|f| f.rule == rule)
            .collect();
        apply(text, &found)
    }

    /// The pair list for one expected fix.
    pub fn one(original: &str, suggestion: &str) -> Vec<(String, Option<String>)> {
        vec![(original.to_string(), Some(suggestion.to_string()))]
    }

    pub fn flagged(original: &str) -> Vec<(String, Option<String>)> {
        vec![(original.to_string(), None)]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_pick_rules_by_priority_and_category() {
        let r = |id| registry::info(id);
        assert!(allowed(r("zh.word.typo"), Level::Typos, false));
        assert!(!allowed(r("zh.punct.halfwidth"), Level::Typos, false));
        assert!(allowed(r("zh.punct.halfwidth"), Level::Standard, false));
        assert!(!allowed(r("en.word.wordy"), Level::Standard, false));
        assert!(allowed(r("en.word.wordy"), Level::Strict, false));
        assert!(allowed(r("en.punct.dash-style"), Level::Standard, true));
        assert!(!allowed(r("en.punct.dash-style"), Level::Standard, false));
        assert!(allowed(r("tw.gongwen.year"), Level::Standard, false));
    }

    #[test]
    fn the_grammar_check_gets_paragraph_rules_only() {
        let conv = Conventions::default();
        let found = check(
            "今天下午开会,大家讨论了三个问题.",
            &conv,
            Level::Standard,
            &[],
        );
        let pairs: Vec<(&str, &str)> = found
            .iter()
            .map(|f| (f.original.as_str(), f.suggestion.as_deref().unwrap()))
            .collect();
        assert_eq!(pairs, [(",", "，"), (".", "。")]);
        assert_eq!(found[0].message, "中文句子里应使用全角标点。");
        // Typos level: spelling rules only.
        assert!(check("今天下午开会,大家讨论了三个问题.", &conv, Level::Typos, &[]).is_empty());
        let typo = check("我们要再接再励,继续努力。", &conv, Level::Typos, &[]);
        assert_eq!(typo.len(), 1);
        assert_eq!(typo[0].suggestion.as_deref(), Some("再接再厉"));
        // Too short to tell the language: nothing language-specific.
        assert!(check("ok , fine", &conv, Level::Standard, &[]).is_empty());
    }

    #[test]
    fn apply_skips_overlaps_and_is_idempotent() {
        let conv = Conventions::default();
        let text = "我们用React写了一个工具,很快...真的。";
        let found = check(text, &conv, Level::Standard, &[]);
        let once = apply(text, &found);
        assert_eq!(once, "我们用React写了一个工具，很快……真的。");
        assert!(check(&once, &conv, Level::Standard, &[])
            .iter()
            .all(|f| f.fix != Fix::Safe));
    }

    #[test]
    fn a_paragraph_checks_well_under_budget() {
        let conv = Conventions::default();
        let para = "我们用 React 和 Tauri 重写了编辑器,启动时间从 3 秒降到了 800ms。The rewrite took two months, and the the team shipped it. ".repeat(20);
        let start = std::time::Instant::now();
        for _ in 0..10 {
            check(&para, &conv, Level::Strict, &[]);
        }
        // ~2,000 chars x 10 runs; generous for debug builds and CI.
        assert!(start.elapsed().as_millis() < 3_000, "{:?}", start.elapsed());
    }
}

#[cfg(test)]
mod sweep;
