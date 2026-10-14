//! Chinese rules (CATALOGUE.md §3.2): the region-neutral ones for both
//! scripts, and the mainland (GB/T) ones for zh-Hans-CN and zh-Hant-CN.
//! Taiwan and Hong Kong rules are in tw.rs. Messages are in Chinese, in the
//! script of the text.

use super::stats::minority;
use super::text::*;
use super::zhdata;
use super::{Block, Ctx, Lang, Out};
use regex::Regex;
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;

/// A message in the text's script: (Simplified, Traditional).
fn m(ctx: &Ctx, hans: &str, hant: &str) -> String {
    if ctx.lang == Lang::ZhHant {
        hant.to_string()
    } else {
        hans.to_string()
    }
}

pub(crate) fn run(t: &Text, ctx: &Ctx, out: &mut Out) {
    let mainland = ctx.profile.mainland();
    halfwidth(t, ctx, out);
    fullwidth_adjacent(t, ctx, out);
    ellipsis(t, ctx, out);
    ellipsis_deng(t, ctx, out);
    stacked(t, ctx, out);
    heading_end(t, ctx, out);
    cjk_latin(t, ctx, out);
    width_alnum(t, ctx, out);
    decimal(t, ctx, out);
    mixed_date(t, ctx, out);
    short_year(t, ctx, out);
    date_dunhao(t, ctx, out);
    typo(t, ctx, out);
    unit_space(t, ctx, out);
    ascii_range(t, ctx, out);
    compat_ideograph(t, ctx, out);
    clause_length(t, ctx, out);
    if mainland {
        dash(t, ctx, out);
        quote_straight(t, ctx, out);
        approx(t, ctx, out);
        title_dunhao(t, ctx, out);
        mixed_unit(t, ctx, out);
        middot(t, ctx, out);
        gongwen(t, ctx, out);
        ad(t, ctx, out);
    }
    if ctx.lang == Lang::ZhHans {
        variant(t, ctx, out);
        script_mixed(t, ctx, out);
    }
    if ctx.lang == Lang::ZhHant {
        super::tw::run(t, ctx, out);
    }
}

/// CJK text or a closing CJK mark: what a Chinese sentence's punctuation
/// follows.
fn cjk_before(c: char) -> bool {
    is_cjk(c) || matches!(c, '”' | '’' | '」' | '』' | '）' | '》' | '】' | '〕')
}

/// The next non-space character from `i`, and where it is.
fn next_non_space(t: &Text, i: usize) -> (Option<char>, usize) {
    let mut j = i;
    while j < t.len() && t.chars[j] == ' ' {
        j += 1;
    }
    (t.at(j), j)
}

fn opens_cjk(c: char) -> bool {
    is_cjk(c) || matches!(c, '“' | '‘' | '「' | '『' | '（' | '《' | '【' | '〔')
}

/// zh.punct.halfwidth: , . ; : ? ! ( ) typed with an English input
/// method inside a Chinese sentence -> ，。；：？！（）. Not decimals (3.14),
/// times (8:00), list markers ("1."), file names, or English segments.
fn halfwidth(t: &Text, ctx: &Ctx, out: &mut Out) {
    let msg = m(
        ctx,
        "中文句子里应使用全角标点。",
        "中文句子裡應使用全形標點。",
    );
    let n = t.len();
    for i in 0..n {
        let c = t.chars[i];
        let full = match c {
            ',' => '，',
            '.' => '。',
            ';' => '；',
            ':' => '：',
            '?' => '？',
            '!' => '！',
            _ => continue,
        };
        let Some(prev) = t.before(i) else { continue };
        if !cjk_before(prev) {
            continue;
        }
        let next = t.at(i + 1);
        if c == '.' && matches!(next, Some('.')) {
            continue; // an ellipsis: zh.punct.ellipsis
        }
        if matches!(c, '!' | '?') && matches!(next, Some('!' | '?' | '！' | '？')) {
            // "好!!" - fix the first; the rest follow as their own hits.
        }
        let (after, j) = next_non_space(t, i + 1);
        let ends = after.is_none();
        let ok = match after {
            None => true,
            Some(q) => {
                opens_cjk(q)
                    || (matches!(c, '!' | '?') && matches!(q, '!' | '?' | '！' | '？' | '”' | '」'))
            }
        };
        if !(ok || ends) {
            continue;
        }
        // Keep spaces after it only when they lead nowhere (end of text).
        let end = if ends { i + 1 } else { j.max(i + 1) };
        let end = if end > i + 1 && !t.chars[i + 1..end].iter().all(|&ch| ch == ' ') {
            i + 1
        } else {
            end
        };
        out.fix("zh.punct.halfwidth", i, end, full.to_string(), msg.clone());
    }
    // Parentheses around Chinese text.
    let mut stack: Vec<usize> = Vec::new();
    for i in 0..n {
        match t.chars[i] {
            '(' => stack.push(i),
            ')' => {
                if let Some(a) = stack.pop() {
                    let inner_cjk = t.chars[a + 1..i].iter().any(|&ch| is_cjk(ch));
                    let outer_cjk =
                        t.before(a).is_some_and(is_cjk) || t.at(i + 1).is_some_and(is_cjk);
                    if inner_cjk && outer_cjk && !t.guarded(a, i + 1) {
                        out.fix("zh.punct.halfwidth", a, a + 1, "（", msg.clone());
                        out.fix("zh.punct.halfwidth", i, i + 1, "）", msg.clone());
                    }
                }
            }
            _ => {}
        }
    }
}

/// Full-width marks that take no space beside them; the curly quotes,
/// dashes and ellipsis only when Chinese text is on the other side.
fn fullwidth_adjacent(t: &Text, ctx: &Ctx, out: &mut Out) {
    let msg = m(ctx, "全角标点前后不加空格。", "全形標點前後不加空格。");
    let n = t.len();
    let mut i = 0;
    while i < n {
        if t.chars[i] != ' ' && t.chars[i] != '\u{3000}' {
            i += 1;
            continue;
        }
        let a = i;
        while i < n && (t.chars[i] == ' ' || t.chars[i] == '\u{3000}') {
            i += 1;
        }
        let b = i;
        if a == 0 || b >= n {
            continue;
        }
        let (l, r) = (t.chars[a - 1], t.chars[b]);
        let left_mark = is_fullwidth_punct(l)
            || (matches!(l, '”' | '’' | '…' | '—') && is_cjk_text(r))
            || (matches!(l, '“' | '‘') && is_cjk_text(r));
        let right_mark = is_fullwidth_punct(r)
            || (matches!(r, '“' | '‘' | '…' | '—') && is_cjk_text(l))
            || (matches!(r, '”' | '’') && is_cjk_text(l));
        // An ideographic space after ？！ is a Japanese convention, and a
        // leading one is an indent: neither is this rule's.
        if left_mark || right_mark {
            out.fix(
                "zh.space.fullwidth-adjacent",
                a - 1,
                b + 1,
                format!("{l}{r}"),
                msg.clone(),
            );
        }
    }
}

static DOTS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\.{3,}|。{3,}|…+|⋯+|·{3,}").unwrap());

/// zh.punct.ellipsis: ... 。。。 a lone … ⋯⋯ and runs longer than two
/// pairs -> …… (two pairs, the twelve dots for omitted paragraphs, stay).
fn ellipsis(t: &Text, ctx: &Ctx, out: &mut Out) {
    let msg = m(
        ctx,
        "中文省略号用“……”（两个“…”）。",
        "中文刪節號用「……」（兩個「…」）。",
    );
    for (a, b) in t.find(&DOTS) {
        let run = t.slice(a, b);
        if run == "……" || run == "…………" {
            continue;
        }
        let near_cjk = t.before(a).is_some_and(cjk_before)
            || t.at(b).is_some_and(opens_cjk)
            || t.at(b).is_some_and(is_fullwidth_punct);
        let chinese_run = run.starts_with('。') || run.starts_with('⋯') || run.starts_with('…');
        if !near_cjk
            && !(chinese_run
                && (t.before(a).is_some_and(is_cjk_text) || t.at(b).is_some_and(is_cjk_text)))
        {
            continue;
        }
        // "……等" is zh.punct.ellipsis-deng's.
        if t.at(b) == Some('等') || find_str(t, "什么的").iter().any(|&(x, _)| x == b) {
            continue;
        }
        out.fix("zh.punct.ellipsis", a, b, "……", msg.clone());
    }
}

/// zh.punct.ellipsis-deng: an ellipsis and 等/等等/什么的 say the same thing.
fn ellipsis_deng(t: &Text, ctx: &Ctx, out: &mut Out) {
    let msg = m(
        ctx,
        "省略号和“等”“等等”“什么的”不同时使用。",
        "刪節號和「等」「等等」不同時使用。",
    );
    for (a, b) in t.find(&DOTS) {
        if !t.before(a).is_some_and(cjk_before) {
            continue;
        }
        for word in ["等等", "等", "什么的", "什麼的"] {
            if t.chars[b..].starts_with(&word.chars().collect::<Vec<_>>()) {
                let w = word.chars().count();
                out.fix("zh.punct.ellipsis-deng", a, b + w, word, msg.clone());
                break;
            }
        }
    }
}

static DASH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"-{2,}|－{2,}|─{2}|―{2}|—").unwrap());

/// The length of the run of CJK letters ending at `i` (exclusive) or
/// starting at `i`.
fn cjk_run_left(t: &Text, i: usize) -> usize {
    t.chars[..i]
        .iter()
        .rev()
        .take_while(|&&c| is_cjk(c))
        .count()
}
fn cjk_run_right(t: &Text, i: usize) -> usize {
    t.chars[i..].iter().take_while(|&&c| is_cjk(c)).count()
}

/// zh.punct.dash (mainland): -- －－ ── ―― and a single — between Chinese
/// clauses -> ——. A single — between numbers, dates or places is the range
/// connector (北京—上海): only a dash with long clauses on both sides is
/// taken for a break.
fn dash(t: &Text, ctx: &Ctx, out: &mut Out) {
    let msg = m(ctx, "中文破折号用“——”（两个“—”）。", "中文破折號用「——」。");
    for (a, b) in t.find(&DASH) {
        let run = t.slice(a, b);
        let (l, r) = (t.before(a), t.at(b));
        let cjk_side = l.is_some_and(cjk_before) || r.is_some_and(opens_cjk);
        if !cjk_side {
            continue;
        }
        if run == "—" {
            if t.at(b) == Some('—') || t.before(a) == Some('—') {
                continue;
            }
            if l.is_some_and(is_cjk)
                && r.is_some_and(is_cjk)
                && cjk_run_left(t, a) >= 5
                && cjk_run_right(t, b) >= 5
            {
                out.fix("zh.punct.dash", a, b, "——", msg.clone());
            }
            continue;
        }
        if run.starts_with('-')
            && l.is_some_and(|c| c.is_ascii_digit())
            && r.is_some_and(|c| c.is_ascii_digit())
        {
            continue;
        }
        out.fix("zh.punct.dash", a, b, "——", msg.clone());
    }
}

/// zh.punct.stacked: more than `stacked-marks` ？ or ！ in a row (three in
/// fiction, one elsewhere); one of each, ？！, is always fine.
fn stacked(t: &Text, ctx: &Ctx, out: &mut Out) {
    let max: usize = match ctx.profile.opt("stacked-marks") {
        Some("3") => 3,
        Some("1") => 1,
        _ if ctx.profile.is("fiction") => 3,
        // Automatic: the GB limit; the tech and official profiles allow one.
        _ if ctx.profile.explicit && !ctx.profile.is("fiction") => 1,
        _ => 3,
    };
    let msg = m(
        ctx,
        "问号、叹号不宜连用过多。",
        "問號、驚嘆號不宜連用過多。",
    );
    let n = t.len();
    let mut i = 0;
    while i < n {
        if !matches!(t.chars[i], '！' | '？') {
            i += 1;
            continue;
        }
        let a = i;
        while i < n && matches!(t.chars[i], '！' | '？') {
            i += 1;
        }
        let run: Vec<char> = t.chars[a..i].to_vec();
        let mixed_pair = run.len() == 2 && run[0] != run[1];
        if run.len() <= max || mixed_pair {
            continue;
        }
        let fixed: String = if max == 1 {
            if run.contains(&'？') && run.contains(&'！') {
                "？！".into()
            } else {
                run[0].to_string()
            }
        } else {
            run[..max].iter().collect()
        };
        out.fix("zh.punct.stacked", a, i, fixed, msg.clone());
    }
}

/// zh.heading.end-punct: a heading ending in 。，、；：.
fn heading_end(t: &Text, ctx: &Ctx, out: &mut Out) {
    if !ctx.block.is_heading() {
        return;
    }
    let trimmed = t.s.trim_end().chars().count();
    if trimmed > 0 && matches!(t.chars[trimmed - 1], '。' | '，' | '、' | '；' | '：') {
        out.fix(
            "zh.heading.end-punct",
            trimmed - 1,
            trimmed,
            "",
            m(
                ctx,
                "标题末尾不用句号、逗号等点号。",
                "標題末尾不用句號、逗號等標點。",
            ),
        );
    }
}

/// zh.quote.straight (mainland): straight quotes around Chinese -> “” ‘’
/// (or 「」『』 with quotes=corner). Code, English quotations and unmatched
/// quotes are left alone.
fn quote_straight(t: &Text, ctx: &Ctx, out: &mut Out) {
    let corner = ctx.profile.opt("quotes") == Some("corner");
    let msg = if corner {
        m(
            ctx,
            "中文引号用「」，内层用『』。",
            "中文引號用「」，內層用『』。",
        )
    } else {
        m(ctx, "中文引号用“”，内层用‘’。", "中文引號用“”，內層用‘’。")
    };
    for (q, open, close) in [
        (
            '"',
            if corner { "「" } else { "“" },
            if corner { "」" } else { "”" },
        ),
        (
            '\'',
            if corner { "『" } else { "‘" },
            if corner { "』" } else { "’" },
        ),
    ] {
        let marks: Vec<usize> = (0..t.len())
            .filter(|&i| t.chars[i] == q && !t.protected[i])
            // An apostrophe between letters isn't a quote.
            .filter(|&i| {
                q != '\''
                    || !(t.before(i).is_some_and(|c| c.is_alphanumeric())
                        && t.at(i + 1).is_some_and(|c| c.is_alphanumeric())
                        && !t.before(i).is_some_and(is_cjk))
            })
            .collect();
        if !marks.len().is_multiple_of(2) {
            continue;
        }
        for pair in marks.chunks(2) {
            let (a, b) = (pair[0], pair[1]);
            let inner = &t.chars[a + 1..b];
            let cjk = inner.iter().filter(|&&c| is_cjk(c)).count();
            let latin = inner.iter().filter(|&&c| is_latin_letter(c)).count();
            let outside =
                t.before(a).is_some_and(is_cjk_text) || t.at(b + 1).is_some_and(is_cjk_text);
            if cjk > 0 && cjk * 3 >= latin && (outside || cjk >= latin) {
                out.fix("zh.quote.straight", a, a + 1, open, msg.clone());
                out.fix("zh.quote.straight", b, b + 1, close, msg.clone());
            }
        }
    }
}

/// zh.space.cjk-latin: spaces between Chinese and Latin letters or digits
/// by the profile's `cjk-latin-space`: `on` adds them, `off` and `layout`
/// remove typed ones, Automatic flags only the minority form when the
/// text's majority is clear. Never next to punctuation, %, or °.
fn cjk_latin(t: &Text, ctx: &Ctx, out: &mut Out) {
    let mode = match ctx.profile.opt("cjk-latin-space") {
        Some(v) => v,
        None if ctx.profile.is("tech") => "on",
        None => "auto",
    };
    let s = ctx.stats;
    let (add, remove) = match mode {
        "on" => (true, false),
        "off" | "layout" => (false, true),
        _ => (
            minority(s.cjk_latin_tight, s.cjk_latin_spaced),
            minority(s.cjk_latin_spaced, s.cjk_latin_tight),
        ),
    };
    let auto = mode == "auto";
    let n = t.len();
    for i in 0..n.saturating_sub(1) {
        let (c, d) = (t.chars[i], t.chars[i + 1]);
        if add && ((is_cjk(c) && is_latin_or_digit(d)) || (is_latin_or_digit(c) && is_cjk(d))) {
            let msg = if auto {
                m(
                    ctx,
                    "中文与英文、数字之间加空格（与本文多数写法一致）。",
                    "中文與英文、數字之間加空格（與本文多數寫法一致）。",
                )
            } else {
                m(
                    ctx,
                    "按所选规范，中文与英文、数字之间加空格。",
                    "按所選規範，中文與英文、數字之間加空格。",
                )
            };
            out.fix("zh.space.cjk-latin", i, i + 2, format!("{c} {d}"), msg);
        }
        if remove && c == ' ' && i > 0 {
            let p = t.chars[i - 1];
            if (is_cjk(p) && is_latin_or_digit(d)) || (is_latin_or_digit(p) && is_cjk(d)) {
                let msg = if auto {
                    m(
                        ctx,
                        "中文与英文、数字之间不加空格（与本文多数写法一致）。",
                        "中文與英文、數字之間不加空格（與本文多數寫法一致）。",
                    )
                } else {
                    m(
                        ctx,
                        "按所选规范，中文与英文、数字之间不加空格。",
                        "按所選規範，中文與英文、數字之間不加空格。",
                    )
                };
                out.fix("zh.space.cjk-latin", i - 1, i + 2, format!("{p}{d}"), msg);
            }
        }
    }
}

/// zh.width.alnum: full-width letters and digits (Ａ１) -> half-width.
/// Taiwanese 公文 numbers its items with full-width digits (１、).
fn width_alnum(t: &Text, ctx: &Ctx, out: &mut Out) {
    let tw_gongwen = ctx.lang == Lang::ZhHant && ctx.profile.is("gongwen");
    let fw = |c: char| {
        matches!(c, '０'..='９' | 'Ａ'..='Ｚ' | 'ａ'..='ｚ') && !(tw_gongwen && c.is_numeric())
    };
    let msg = m(
        ctx,
        "全角字母和数字应改为半角。",
        "全形字母和數字應改為半形。",
    );
    let n = t.len();
    let mut i = 0;
    while i < n {
        if !fw(t.chars[i]) {
            i += 1;
            continue;
        }
        let a = i;
        while i < n && fw(t.chars[i]) {
            i += 1;
        }
        let half: String = t.chars[a..i]
            .iter()
            .map(|&c| char::from_u32(c as u32 - 0xFEE0).unwrap_or(c))
            .collect();
        out.fix("zh.width.alnum", a, i, half, msg.clone());
    }
}

static DECIMAL_MARU: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d。\d").unwrap());
static DECIMAL_BARE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\.\d+").unwrap());

/// zh.num.decimal: 0。46 and .46 -> 0.46.
fn decimal(t: &Text, ctx: &Ctx, out: &mut Out) {
    let msg = m(
        ctx,
        "小数点用“.”，整数部分的 0 不能省略。",
        "小數點用「.」，整數部分的 0 不能省略。",
    );
    for (a, _) in t.find(&DECIMAL_MARU) {
        out.fix("zh.num.decimal", a + 1, a + 2, ".", msg.clone());
    }
    for (a, b) in t.find(&DECIMAL_BARE) {
        let before_ok = t
            .before(a)
            .is_none_or(|c| is_cjk(c) || c == ' ' || matches!(c, '（' | '，' | '：'));
        let after_ok = t
            .at(b)
            .is_none_or(|c| !(c == '.' || c.is_ascii_alphanumeric()));
        if before_ok && after_ok && t.before(a).is_some_and(is_cjk) {
            out.fix(
                "zh.num.decimal",
                a,
                b,
                format!("0{}", t.slice(a, b)),
                msg.clone(),
            );
        }
    }
}

const MEASURE: &str =
    "个天日月年人次岁小时分钟周名位本件元块斤里米倍成层家项条辆台张页章节句只头匹";

static APPROX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([1-9])、([1-9])").unwrap());
static JI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"几(\d+)").unwrap());

/// zh.num.approx (mainland): 3、4个 -> 三四个, 几1000 -> 几千. Only adjacent
/// numbers before a measure word, never after 第 or in a list.
fn approx(t: &Text, ctx: &Ctx, out: &mut Out) {
    const DIGITS: [&str; 10] = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    for caps in t.captures(&APPROX) {
        let (Some((a, b)), Some((x, _)), Some((y, _))) = (caps[0], caps[1], caps[2]) else {
            continue;
        };
        let (p, q) = (
            t.chars[x].to_digit(10).unwrap(),
            t.chars[y].to_digit(10).unwrap(),
        );
        let measure = t.at(b).is_some_and(|c| MEASURE.contains(c));
        let listed = t
            .before(a)
            .is_some_and(|c| c == '第' || c == '、' || c.is_ascii_digit())
            || t.at(b) == Some('、');
        if q == p + 1 && measure && !listed {
            out.fix(
                "zh.num.approx",
                a,
                b,
                format!("{}{}", DIGITS[p as usize], DIGITS[q as usize]),
                "相邻数字表示概数时用汉字，不加顿号：“三四个”。",
            );
        }
    }
    for caps in t.captures(&JI) {
        let (Some((a, b)), Some((x, y))) = (caps[0], caps[1]) else {
            continue;
        };
        let unit = match t.slice(x, y).as_str() {
            "10" => Some("十"),
            "100" => Some("百"),
            "1000" => Some("千"),
            "10000" => Some("万"),
            _ => None,
        };
        let msg = "“几”后用汉字数字：“几千”。";
        match unit {
            Some(u) => out.fix("zh.num.approx", a, b, format!("几{u}"), msg),
            None => out.flag("zh.num.approx", a, b, msg),
        }
    }
    let _ = ctx;
}

/// zh.title.dunhao (mainland): 《A》、《B》 -> 《A》《B》.
fn title_dunhao(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, _) in find_str(t, "》、《") {
        out.fix(
            "zh.title.dunhao",
            a,
            a + 3,
            "》《",
            "并列的书名号之间一般不用顿号。",
        );
    }
}

static MIXED_DATE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[〇○零一二三四五六七八九]{4}年\d{1,2}月|\d{4}年[一二三四五六七八九十]{1,3}月")
        .unwrap()
});

/// zh.num.mixed-date: 二〇二六年10月 - one date in two numeral systems.
fn mixed_date(t: &Text, ctx: &Ctx, out: &mut Out) {
    for (a, b) in t.find(&MIXED_DATE) {
        out.flag(
            "zh.num.mixed-date",
            a,
            b,
            m(
                ctx,
                "同一个日期不要混用汉字数字和阿拉伯数字。",
                "同一個日期不要混用中文數字和阿拉伯數字。",
            ),
        );
    }
}

static SHORT_YEAR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d{2,4}年\d{1,2}月").unwrap());

/// zh.num.short-year: 98年5月 - a year shortened to two digits (90年代 is
/// usage, and 活了90年 is a duration: only year-month dates are taken).
fn short_year(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.lang == Lang::ZhHant {
        return; // 民國 years are two- and three-digit.
    }
    for (a, b) in t.find(&SHORT_YEAR) {
        let digits = t.chars[a..b]
            .iter()
            .take_while(|c| c.is_ascii_digit())
            .count();
        if digits == 2 && !t.before(a).is_some_and(|c| c.is_ascii_digit()) {
            out.flag("zh.num.short-year", a, a + 3, "年份应写全，如“1998年”。");
        }
    }
}

static MIXED_UNIT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(\d+)([百千])([零〇]?\d+)?|[一二三四五六七八九十百千]+[零〇]?\d+").unwrap()
});

/// zh.num.mixed-unit (mainland): 4千, 1百零8, 一百08 - Arabic digits mix
/// only with 万 and 亿. 千米, 千克, 千瓦, 百分 are units, not numbers.
fn mixed_unit(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.profile.is("gongwen") && ctx.lang == Lang::ZhHant {
        return;
    }
    let msg = m(
        ctx,
        "阿拉伯数字只与“万”“亿”连用：写“4000”，不写“4千”。",
        "阿拉伯數字只與「萬」「億」連用：寫「4000」，不寫「4千」。",
    );
    for caps in t.captures(&MIXED_UNIT) {
        let Some((a, b)) = caps[0] else { continue };
        let next = t.at(b);
        if next.is_some_and(|c| "米克瓦卡兆赫分字".contains(c))
            || t.before(a)
                .is_some_and(|c| c.is_ascii_digit() || is_han(c) && "第周".contains(c))
        {
            continue;
        }
        match (caps[1], caps[2], caps[3]) {
            (Some((x, y)), Some((u, _)), None) => {
                let digits = t.slice(x, y);
                let zeros = if t.chars[u] == '千' { "000" } else { "00" };
                if digits.len() <= 3 {
                    out.fix(
                        "zh.num.mixed-unit",
                        a,
                        b,
                        format!("{digits}{zeros}"),
                        msg.clone(),
                    );
                }
            }
            _ => out.flag("zh.num.mixed-unit", a, b, msg.clone()),
        }
    }
}

static HYPHEN_DATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?-u:\b)(\d{4})-(\d)(?-u:\b)").unwrap());

/// zh.date.dunhao: an incomplete hyphen date (2008-8).
fn date_dunhao(t: &Text, ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&HYPHEN_DATE) {
        let (Some((a, b)), Some((y1, y2)), Some((d, _))) = (caps[0], caps[1], caps[2]) else {
            continue;
        };
        if t.at(b) == Some('-') || t.at(b).is_some_and(|c| c.is_ascii_digit()) {
            continue;
        }
        out.fix(
            "zh.date.dunhao",
            a,
            b,
            format!("{}-0{}", t.slice(y1, y2), t.chars[d]),
            m(
                ctx,
                "用连接号的日期，月、日写两位，如“2008-08”。",
                "用連接號的日期，月、日寫兩位，如「2008-08」。",
            ),
        );
    }
}

/// zh.punct.middot (mainland): • ・ ‧ between the parts of a name -> ·.
fn middot(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for i in 1..t.len().saturating_sub(1) {
        if matches!(t.chars[i], '•' | '・' | '‧')
            && is_han(t.chars[i - 1])
            && is_han(t.chars[i + 1])
        {
            out.fix(
                "zh.punct.middot",
                i,
                i + 1,
                "·",
                "外国人名等各部分之间用间隔号“·”。",
            );
        }
    }
}

/// zh.word.typo: the wrong-character list; not inside a quotation (which
/// may be quoting the error).
fn typo(t: &Text, ctx: &Ctx, out: &mut Out) {
    for (wrong, right) in zhdata::TYPOS {
        for (a, b) in find_str(t, wrong) {
            if !t.in_quotes(a, b) {
                out.fix(
                    "zh.word.typo",
                    a,
                    b,
                    *right,
                    if ctx.lang == Lang::ZhHant {
                        format!("錯別字：應為「{right}」。")
                    } else {
                        format!("错别字：应为“{right}”。")
                    },
                );
            }
        }
    }
}

/// zh.word.variant: GF 1001 variant words -> the recommended form.
fn variant(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (var, rec) in zhdata::VARIANTS {
        for (a, b) in find_str(t, var) {
            if !t.in_quotes(a, b) {
                out.fix(
                    "zh.word.variant",
                    a,
                    b,
                    *rec,
                    format!("异形词：推荐写作“{rec}”。"),
                );
            }
        }
    }
}

/// zh.script.mixed: a Traditional character in Simplified text - only a
/// stray one (the text is clearly Simplified), never inside a quotation.
fn script_mixed(t: &Text, _ctx: &Ctx, out: &mut Out) {
    let (mut hans, mut hant) = (0, 0);
    for p in zhdata::script_pairs() {
        hans += t
            .chars
            .iter()
            .filter(|&&c| c == p.0 && p.2 != zhdata::Pair::TradOnly)
            .count();
        hant += t
            .chars
            .iter()
            .filter(|&&c| c == p.1 && p.2 != zhdata::Pair::SimpOnly)
            .count();
    }
    if hans < 2 * hant.max(1) {
        return;
    }
    for i in 0..t.len() {
        if let Some(s) = zhdata::to_simplified(t.chars[i]) {
            if !t.in_quotes(i, i + 1) {
                out.fix(
                    "zh.script.mixed",
                    i,
                    i + 1,
                    s.to_string(),
                    format!("简体文本中混入了繁体字“{}”，应为“{s}”。", t.chars[i]),
                );
            }
        }
    }
}

static UNIT_SPACE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d[ \u{00A0}]+[%°℃‰′″]").unwrap());

/// zh.num.unit-space: no space between a number and % ° ′ ″.
fn unit_space(t: &Text, ctx: &Ctx, out: &mut Out) {
    for (a, b) in t.find(&UNIT_SPACE) {
        out.fix(
            "zh.num.unit-space",
            a,
            b,
            format!("{}{}", t.chars[a], t.chars[b - 1]),
            m(
                ctx,
                "数字与 %、° 等符号之间不加空格。",
                "數字與 %、° 等符號之間不加空格。",
            ),
        );
    }
}

static ASCII_RANGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?-u:\b)(\d{1,4})-(\d{1,4})(?-u:\b)").unwrap());

/// zh.num.ascii-range: 3-5天 -> 3～5天. Not full dates, codes, phone or
/// model numbers: only a short range before a Chinese measure word.
fn ascii_range(t: &Text, ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&ASCII_RANGE) {
        let (Some((a, b)), Some((x1, x2)), Some((y1, y2))) = (caps[0], caps[1], caps[2]) else {
            continue;
        };
        let before_ok = t
            .before(a)
            .is_none_or(|c| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '/')));
        let after_ok = t
            .at(b)
            .is_some_and(|c| is_han(c) && (MEASURE.contains(c) || "℃度分秒期岁届".contains(c)));
        let date_like = x2 - x1 == 4 && y2 - y1 == 2;
        if before_ok && after_ok && !date_like && t.at(b) != Some('-') {
            out.fix(
                "zh.num.ascii-range",
                a,
                b,
                format!("{}～{}", t.slice(x1, x2), t.slice(y1, y2)),
                m(
                    ctx,
                    "表示数值范围用“～”或“—”，不用“-”。",
                    "表示數值範圍用「～」，不用「-」。",
                ),
            );
        }
    }
}

/// zh.compat-ideograph: CJK compatibility ideographs (pasted from PDFs)
/// -> the unified ones, except the twelve that are unified themselves.
fn compat_ideograph(t: &Text, ctx: &Ctx, out: &mut Out) {
    const UNIFIED: [u32; 12] = [
        0xFA0E, 0xFA0F, 0xFA11, 0xFA13, 0xFA14, 0xFA1F, 0xFA21, 0xFA23, 0xFA24, 0xFA27, 0xFA28,
        0xFA29,
    ];
    for i in 0..t.len() {
        let c = t.chars[i];
        if matches!(c, '\u{F900}'..='\u{FAFF}' | '\u{2F800}'..='\u{2FA1F}')
            && !UNIFIED.contains(&(c as u32))
        {
            let unified: String = c.to_string().nfc().collect();
            if unified != c.to_string() {
                out.fix(
                    "zh.compat-ideograph",
                    i,
                    i + 1,
                    unified,
                    m(
                        ctx,
                        "兼容汉字（常见于从 PDF 复制的文字）：应改为统一汉字。",
                        "相容漢字（常見於從 PDF 複製的文字）：應改為統一漢字。",
                    ),
                );
            }
        }
    }
}

/// zh.style.clause-length: a clause of more than 40 characters with no
/// punctuation (not in fiction, not in quotations).
fn clause_length(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.profile.is("fiction") || ctx.block.is_heading() {
        return;
    }
    let mut start = 0;
    for i in 0..=t.len() {
        let end = i == t.len()
            || matches!(
                t.chars[i],
                '，' | '。'
                    | '；'
                    | '：'
                    | '！'
                    | '？'
                    | '、'
                    | ','
                    | '.'
                    | ';'
                    | ':'
                    | '!'
                    | '?'
                    | '…'
                    | '—'
                    | '\n'
                    | '“'
                    | '”'
                    | '「'
                    | '」'
                    | '（'
                    | '）'
            );
        if end {
            let len = t.chars[start..i].iter().filter(|&&c| is_cjk(c)).count();
            if len > 40 && !t.in_quotes(start, i) {
                out.flag(
                    "zh.style.clause-length",
                    start,
                    i,
                    m(
                        ctx,
                        &format!("这一分句很长（{len} 字没有标点），可以考虑拆开。"),
                        &format!("這一分句很長（{len} 字沒有標點），可以考慮拆開。"),
                    ),
                );
            }
            start = i + 1;
        }
    }
}

static DOCNUM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"([〔\[\(（【［])(\d{4})([〕\]\)）】］])(第?)(0*)(\d+)号").unwrap()
});
static GONGWEN_DATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d{4}年(0?\d{1,2})月(0?\d{1,2})日").unwrap());

/// The 公文 profile (GB/T 9704, 条例): document numbers, dates, titles.
fn gongwen(t: &Text, ctx: &Ctx, out: &mut Out) {
    if !ctx.profile.is("gongwen") {
        return;
    }
    for caps in t.captures(&DOCNUM) {
        let (
            Some((a, b)),
            Some((o, _)),
            Some((y1, y2)),
            Some((c, _)),
            Some((d1, d2)),
            Some((z1, z2)),
            Some((n1, n2)),
        ) = (
            caps[0], caps[1], caps[2], caps[3], caps[4], caps[5], caps[6],
        )
        else {
            continue;
        };
        if t.chars[o] != '〔' || t.chars[c] != '〕' || d2 > d1 || z2 > z1 {
            out.fix(
                "zh.gongwen.docnum",
                a,
                b,
                format!("〔{}〕{}号", t.slice(y1, y2), t.slice(n1, n2)),
                "发文字号写作“代字〔年份〕序号号”：六角括号，序号不加“第”、不编虚位。",
            );
        }
    }
    for caps in t.captures(&GONGWEN_DATE) {
        for g in [caps[1], caps[2]].into_iter().flatten() {
            let (x, y) = g;
            if y - x == 2 && t.chars[x] == '0' {
                out.fix(
                    "zh.gongwen.date",
                    x,
                    y,
                    t.chars[x + 1].to_string(),
                    "成文日期的月、日不编虚位：“2026年10月9日”。",
                );
            }
        }
    }
    if ctx.block.is_heading() || matches!(ctx.block, Block::Heading(1)) {
        for word in ["请示报告", "报告请示"] {
            for (a, b) in find_str(t, word) {
                out.flag(
                    "zh.gongwen.title",
                    a,
                    b,
                    "公文标题不要并用“请示”和“报告”：请示用于请求批准，报告不得夹带请示事项。",
                );
            }
        }
        for i in 0..t.len() {
            if matches!(
                t.chars[i],
                '，' | '。' | '；' | '：' | '！' | '？' | '“' | '”' | '（' | '）'
            ) {
                out.flag(
                    "zh.gongwen.title",
                    i,
                    i + 1,
                    "公文标题中除书名号外，一般不用标点符号。",
                );
            }
        }
    }
}

const AD_ABSOLUTE: &[&str] = &[
    "国家级",
    "最高级",
    "最佳",
    "最好",
    "顶级",
    "首选",
    "史上最",
    "全网最",
    "最低价",
    "第一品牌",
];
static AD_FIRST: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:销量|全国|全球|行业|世界|全网|排名)第一").unwrap());
static AD_HEALTH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"治疗|治愈|疗效|根治").unwrap());
static AD_DATA: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"数据显示|调查显示|研究表明|研究显示|\d+(?:\.\d+)?%的(?:用户|消费者|人|网友)")
        .unwrap()
});

/// The newmedia profile: 广告法 absolute terms (warnings, with the
/// exemptions in the message), treatment claims and unsourced data.
fn ad(t: &Text, _ctx: &Ctx, out: &mut Out) {
    if !_ctx.profile.is("newmedia") {
        return;
    }
    let msg = "广告法禁用绝对化用语；商标、官方奖项或有时间地点限定的真实数据可除外。";
    for word in AD_ABSOLUTE {
        for (a, b) in find_str(t, word) {
            out.flag("zh.ad.absolute", a, b, msg);
        }
    }
    for (a, b) in t.find(&AD_FIRST) {
        out.flag("zh.ad.absolute", a, b, msg);
    }
    for (a, b) in t.find(&AD_HEALTH) {
        out.flag("zh.ad.health", a, b, "非医疗广告不得涉及疾病治疗功能。");
    }
    let sourced = ["来源", "出处", "《", "引自", "据悉", "根据", "据统计"]
        .iter()
        .any(|w| t.s.contains(w));
    if !sourced {
        for (a, b) in t.find(&AD_DATA) {
            out.flag("zh.ad.unsourced", a, b, "引用数据、调查结果请注明出处。");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::testing::*;
    use super::super::{Block, Lang};

    const H: Lang = Lang::ZhHans;

    #[test]
    fn half_width_punctuation_in_chinese() {
        assert_eq!(
            fixed(
                "zh.punct.halfwidth",
                H,
                None,
                "今天下午开会,大家讨论了三个问题.第一个是预算:钱不够!"
            ),
            "今天下午开会，大家讨论了三个问题。第一个是预算：钱不够！"
        );
        // The space after the comma goes with it.
        assert_eq!(
            fixed("zh.punct.halfwidth", H, None, "开会, 大家来了"),
            "开会，大家来了"
        );
        assert_eq!(
            fixed("zh.punct.halfwidth", H, None, "这是测试(内部版本)的结果"),
            "这是测试（内部版本）的结果"
        );
        for ok in [
            "版本 3.14 和 8:00 开会",
            "备份 MySQL 8.0, 保留 30 天。Done, ok.",
            "1. 第一项",
            "打开文件.txt 看看",
            "使用 Node.js 和 (API) 接口",
            "见 https://a.cn/x,y 页面",
        ] {
            assert!(hits("zh.punct.halfwidth", H, None, ok).is_empty(), "{ok}");
        }
    }

    #[test]
    fn no_space_beside_full_width_marks() {
        assert_eq!(
            fixed("zh.space.fullwidth-adjacent", H, None, "你好 ，世界。 再见"),
            "你好，世界。再见"
        );
        assert_eq!(
            fixed("zh.space.fullwidth-adjacent", H, None, "他说 “好” 然后走了"),
            "他说“好”然后走了"
        );
        // Curly quotes in English text are not full-width marks.
        assert!(hits(
            "zh.space.fullwidth-adjacent",
            H,
            None,
            "He said “Hello” to me."
        )
        .is_empty());
    }

    #[test]
    fn ellipses() {
        assert_eq!(
            fixed(
                "zh.punct.ellipsis",
                H,
                None,
                "他想了想...然后走了。。。还有…以及⋯⋯和………"
            ),
            "他想了想……然后走了……还有……以及……和……"
        );
        // Two pairs (omitted paragraphs) and English segments stay.
        assert!(hits("zh.punct.ellipsis", H, None, "前文…………后文").is_empty());
        assert!(hits("zh.punct.ellipsis", H, None, "他说 wait... ok 吧").is_empty());
        assert_eq!(
            fixed(
                "zh.punct.ellipsis-deng",
                H,
                None,
                "苹果、香蕉……等水果，桃子...等等"
            ),
            "苹果、香蕉等水果，桃子等等"
        );
    }

    #[test]
    fn dashes_but_not_ranges() {
        assert_eq!(
            fixed("zh.punct.dash", H, None, "我们必须承认--这件事很难"),
            "我们必须承认——这件事很难"
        );
        assert_eq!(
            fixed("zh.punct.dash", H, None, "他停了一下──然后说"),
            "他停了一下——然后说"
        );
        assert_eq!(
            fixed("zh.punct.dash", H, None, "我们必须要承认—这件事情真的很难"),
            "我们必须要承认——这件事情真的很难"
        );
        for ok in ["北京—上海特快", "1031—1095年", "2023--2024 赛季"] {
            assert!(hits("zh.punct.dash", H, None, ok).is_empty(), "{ok}");
        }
        // Taiwan writes ──: not a mainland rule there.
        assert!(hits("zh.punct.dash", Lang::ZhHant, None, "他停了一下──然後說").is_empty());
    }

    #[test]
    fn stacked_marks_by_profile() {
        assert!(hits(
            "zh.punct.stacked",
            H,
            Some("zh-Hans-CN/fiction"),
            "什么？！你说什么！！！"
        )
        .is_empty());
        assert_eq!(
            hits(
                "zh.punct.stacked",
                H,
                Some("zh-Hans-CN/fiction"),
                "天哪！！！！"
            ),
            one("！！！！", "！！！")
        );
        assert_eq!(
            hits("zh.punct.stacked", H, Some("zh-Hans-CN/tech"), "成功了！！"),
            one("！！", "！")
        );
        assert_eq!(
            hits(
                "zh.punct.stacked",
                H,
                Some("zh-Hans-CN/tech"),
                "真的吗？？！"
            ),
            one("？？！", "？！")
        );
        // ？！ is always fine.
        assert!(hits("zh.punct.stacked", H, Some("zh-Hans-CN/tech"), "真的？！").is_empty());
    }

    #[test]
    fn heading_punctuation() {
        assert_eq!(
            hits_in(
                "zh.heading.end-punct",
                H,
                None,
                "第一章 开始。",
                Block::Heading(2)
            ),
            one("。", "")
        );
        assert!(hits_in(
            "zh.heading.end-punct",
            H,
            None,
            "为什么？",
            Block::Heading(2)
        )
        .is_empty());
        assert!(hits_in(
            "zh.heading.end-punct",
            H,
            None,
            "他走了。",
            Block::Paragraph
        )
        .is_empty());
    }

    #[test]
    fn straight_quotes_around_chinese() {
        assert_eq!(
            fixed("zh.quote.straight", H, None, "他说\"你好\"就走了"),
            "他说“你好”就走了"
        );
        assert_eq!(
            fixed(
                "zh.quote.straight",
                H,
                Some("zh-Hans-CN"),
                "他说\"你好\"就走了"
            ),
            "他说“你好”就走了"
        );
        let corner = super::super::testing::findings(H, None, "x", Block::Unknown);
        assert!(corner.is_empty());
        for ok in [
            "他说 \"hello world\" 吧",
            "只有一个\"引号",
            "代码 `\"a\"` 里",
        ] {
            assert!(hits("zh.quote.straight", H, None, ok).is_empty(), "{ok}");
        }
    }

    #[test]
    fn cjk_latin_spacing_follows_the_majority_or_the_setting() {
        // Automatic: two spaced, one tight -> the tight one is flagged.
        assert_eq!(
            hits("zh.space.cjk-latin", H, None, "我用 React 写了一个Vue 组件"),
            one("个V", "个 V")
        );
        // A tie or a single example: nothing.
        assert!(hits("zh.space.cjk-latin", H, None, "我用React和 Vue").is_empty());
        assert!(hits("zh.space.cjk-latin", H, None, "我用React写的").is_empty());
        // The tech profile wants spaces.
        assert_eq!(
            fixed(
                "zh.space.cjk-latin",
                H,
                Some("zh-Hans-CN/tech"),
                "我用React写的"
            ),
            "我用 React 写的"
        );
        // Never before % or punctuation.
        assert!(hits(
            "zh.space.cjk-latin",
            H,
            Some("zh-Hans-CN/tech"),
            "增长了50%。"
        )
        .iter()
        .all(|(o, _)| !o.contains('%')));
    }

    #[test]
    fn widths_decimals_and_numbers() {
        assert_eq!(
            fixed("zh.width.alnum", H, None, "第Ａ１号文件"),
            "第A1号文件"
        );
        assert!(hits(
            "zh.width.alnum",
            Lang::ZhHant,
            Some("zh-Hant-TW/gongwen"),
            "１、說明"
        )
        .is_empty());
        assert_eq!(
            fixed("zh.num.decimal", H, None, "比例是0。46，或者是.46"),
            "比例是0.46，或者是0.46"
        );
        assert_eq!(
            fixed("zh.num.approx", H, None, "过了3、4个月"),
            "过了三四个月"
        );
        assert_eq!(
            fixed("zh.num.approx", H, None, "来了几1000人"),
            "来了几千人"
        );
        for ok in ["第3、4个", "1、2、3个", "3、5个", "二、三产业"] {
            assert!(hits("zh.num.approx", H, None, ok).is_empty(), "{ok}");
        }
        assert!(hits("zh.num.approx", Lang::ZhHant, None, "約3、4天").is_empty());
        assert_eq!(
            fixed("zh.title.dunhao", H, None, "读了《红楼梦》、《水浒传》"),
            "读了《红楼梦》《水浒传》"
        );
        assert_eq!(
            hits("zh.num.mixed-date", H, None, "二〇二六年10月").len(),
            1
        );
        assert_eq!(hits("zh.num.short-year", H, None, "98年5月出生").len(), 1);
        assert!(hits("zh.num.short-year", H, None, "90年代，活了90年").is_empty());
        assert_eq!(fixed("zh.num.mixed-unit", H, None, "有4千人"), "有4000人");
        assert_eq!(hits("zh.num.mixed-unit", H, None, "共1百零8将").len(), 1);
        for ok in ["跑了5千米", "重3千克", "10万人", "3亿元"] {
            assert!(hits("zh.num.mixed-unit", H, None, ok).is_empty(), "{ok}");
        }
        assert_eq!(
            fixed("zh.date.dunhao", H, None, "于2008-8发布"),
            "于2008-08发布"
        );
        assert!(hits("zh.date.dunhao", H, None, "于2008-08-08发布").is_empty());
    }

    #[test]
    fn never_flag_identifiers_and_established_terms() {
        for ok in [
            "2026年的3G网络和MP3",
            "G8峰会讨论维生素B12",
            "电话 010-12345678",
            "型号 A3-200 的价格",
            "第1990号",
        ] {
            let all = findings(H, None, ok, Block::Unknown);
            assert!(
                all.iter().all(|f| !f.rule.starts_with("zh.num")),
                "{ok}: {all:?}"
            );
        }
        assert_eq!(
            fixed("zh.num.ascii-range", H, None, "需要3-5天"),
            "需要3～5天"
        );
        assert_eq!(fixed("zh.num.unit-space", H, None, "增长 50 %"), "增长 50%");
    }

    #[test]
    fn words_script_and_ideographs() {
        assert_eq!(
            fixed("zh.word.typo", H, None, "我们要再接再励"),
            "我们要再接再厉"
        );
        assert!(hits("zh.word.typo", H, None, "“再接再励”是常见错误").is_empty());
        assert_eq!(
            fixed("zh.word.typo", Lang::ZhHant, None, "我們要再接再勵"),
            "我們要再接再厲"
        );
        assert_eq!(
            fixed("zh.word.variant", H, None, "这是惟一的成份"),
            "这是唯一的成分"
        );
        // 蹚水 and 标识 are standard.
        assert!(hits("zh.word.variant", H, None, "蹚水过河的标识").is_empty());
        assert_eq!(
            hits(
                "zh.script.mixed",
                H,
                None,
                "我们这个问题很重要，我們明天再讨论这个问题。"
            ),
            one("們", "们")
        );
        // Mostly Traditional text isn't "Simplified with strays".
        assert!(hits("zh.script.mixed", H, None, "這個問題").is_empty());
        assert_eq!(fixed("zh.compat-ideograph", H, None, "\u{F99A}續"), "連續");
        assert!(hits("zh.compat-ideograph", H, None, "\u{FA11}").is_empty());
    }

    #[test]
    fn middot_and_long_clauses() {
        assert_eq!(
            fixed("zh.punct.middot", H, None, "让・雅克•卢梭"),
            "让·雅克·卢梭"
        );
        let long = "这是一个非常非常长的没有任何标点符号的句子它一直写下去写下去写下去写下去一直到超过了四十个字为止";
        assert_eq!(hits("zh.style.clause-length", H, None, long).len(), 1);
        assert!(hits(
            "zh.style.clause-length",
            H,
            Some("zh-Hans-CN/fiction"),
            long
        )
        .is_empty());
    }

    #[test]
    fn gongwen_and_newmedia_profiles_only() {
        let g = Some("zh-Hans-CN/gongwen");
        assert_eq!(
            fixed("zh.gongwen.docnum", H, g, "国办发[2012]第09号"),
            "国办发〔2012〕9号"
        );
        assert!(hits("zh.gongwen.docnum", H, g, "国办发〔2012〕9号").is_empty());
        assert!(hits("zh.gongwen.docnum", H, None, "国办发[2012]第09号").is_empty());
        assert_eq!(
            fixed("zh.gongwen.date", H, g, "2026年10月09日"),
            "2026年10月9日"
        );
        assert_eq!(
            hits_in(
                "zh.gongwen.title",
                H,
                g,
                "关于经费的请示报告",
                Block::Heading(1)
            )
            .len(),
            1
        );
        let n = Some("zh-Hans-CN/newmedia");
        assert_eq!(
            hits("zh.ad.absolute", H, n, "全网最低，销量第一的最佳选择").len(),
            3
        );
        assert!(hits("zh.ad.absolute", H, n, "这是第一次见面").is_empty());
        assert!(hits("zh.ad.absolute", H, None, "最佳选择").is_empty());
        assert_eq!(
            hits("zh.ad.unsourced", H, n, "数据显示，90%的用户喜欢").len(),
            2
        );
        assert!(hits("zh.ad.unsourced", H, n, "据《年报》数据显示").is_empty());
    }
}
