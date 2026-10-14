//! Korean rules (CATALOGUE.md §3.6), from 한글 맞춤법 and 문장 부호. Never
//! flagged: a comma after a connective ending, `3 개` (allowed spacing),
//! `...` and `…`, `(?)`, thousands commas, `“…” 하고`. Dependent-noun and
//! auxiliary-verb spacing needs morphology and is left to the model.

use super::stats::minority;
use super::text::*;
use super::{Block, Ctx, Out};
use regex::Regex;
use std::sync::LazyLock;

pub(crate) fn run(t: &Text, ctx: &Ctx, out: &mut Out) {
    space_particle(t, ctx, out);
    cjk_marks(t, ctx, out);
    words(t, ctx, out);
    date_format(t, ctx, out);
    colon_space(t, ctx, out);
    double_passive(t, ctx, out);
    honorific_thing(t, ctx, out);
    register_mix(t, ctx, out);
    official(t, ctx, out);
}

/// Standalone particles that attach to the word before them.
const PARTICLES: &[&str] = &[
    "에서", "에게", "으로", "까지", "부터", "처럼", "보다", "이나", "을", "를", "이", "가", "은",
    "는", "의", "에", "로", "와", "과", "도", "만", "나", "랑",
];

/// ko.space.particle: Latin text or a digit, a space, then a particle ->
/// no space ("API 를" -> "API를"). After a digit, 도 (degrees) and 만 (ten
/// thousand) are not particles.
fn space_particle(t: &Text, _ctx: &Ctx, out: &mut Out) {
    let n = t.len();
    for i in 1..n.saturating_sub(1) {
        if t.chars[i] != ' ' {
            continue;
        }
        let prev = t.chars[i - 1];
        if !(prev.is_ascii_alphanumeric() || matches!(prev, ')' | '”' | '’' | '"')) {
            continue;
        }
        // The particle: a run of Hangul after the space, ending the word.
        let mut j = i + 1;
        while j < n && is_hangul(t.chars[j]) {
            j += 1;
        }
        let word = t.slice(i + 1, j);
        let ends_word = t.at(j).is_none_or(|c| {
            c.is_whitespace() || matches!(c, '.' | ',' | '?' | '!' | ')' | ':' | ';')
        });
        if !ends_word || !PARTICLES.contains(&word.as_str()) {
            continue;
        }
        if prev.is_ascii_digit() && matches!(word.as_str(), "도" | "만") {
            continue;
        }
        if matches!(prev, '”' | '"') {
            continue; // “…” 하고, quoted speech
        }
        out.fix(
            "ko.space.particle",
            i - 1,
            j,
            format!("{prev}{word}"),
            "조사는 앞말에 붙여 씁니다.",
        );
    }
}

/// ko.punct.cjk-marks: 。 and 、 in Korean text -> . and , (the 2015 문장
/// 부호 dropped them). Quoted Japanese or Chinese keeps its own.
fn cjk_marks(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for i in 1..t.len() {
        let c = t.chars[i];
        if matches!(c, '。' | '、') && is_hangul(t.chars[i - 1]) {
            let to = if c == '。' { "." } else { "," };
            out.fix(
                "ko.punct.cjk-marks",
                i,
                i + 1,
                to,
                "한국어 문장에는 마침표(.)와 쉼표(,)를 씁니다.",
            );
        }
    }
}

/// ko.word.*: closed spelling lists - 며칠, 돼, 사이시옷, 율/률.
fn words(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, b) in find_str(t, "몇일") {
        out.fix(
            "ko.word.myeochil",
            a,
            b,
            "며칠",
            "‘몇일’이 아니라 ‘며칠’로 씁니다.",
        );
    }
    for (a, b) in find_str(t, "되요") {
        out.fix(
            "ko.word.dwae",
            a,
            b,
            "돼요",
            "‘되어요’의 준말은 ‘돼요’입니다.",
        );
    }
    for (a, b) in find_str(t, "됬") {
        out.fix("ko.word.dwae", a, b, "됐", "‘되었-’의 준말은 ‘됐-’입니다.");
    }
    const SAISIOT: [(&str, &str); 5] = [
        ("햇님", "해님"),
        ("갯수", "개수"),
        ("촛점", "초점"),
        ("댓가", "대가"),
        ("싯가", "시가"),
    ];
    for (wrong, right) in SAISIOT {
        for (a, b) in find_str(t, wrong) {
            out.fix(
                "ko.word.saisiot",
                a,
                b,
                right,
                format!("사이시옷을 쓰지 않습니다: ‘{right}’."),
            );
        }
    }
    const RYUL: [(&str, &str); 12] = [
        ("비률", "비율"),
        ("실패률", "실패율"),
        ("규률", "규율"),
        ("백분률", "백분율"),
        ("할인률", "할인율"),
        ("이자률", "이자율"),
        ("감소률", "감소율"),
        ("증가률", "증가율"),
        ("운률", "운율"),
        ("선률", "선율"),
        ("전률", "전율"),
        ("환률", "환율"),
    ];
    for (wrong, right) in RYUL {
        for (a, b) in find_str(t, wrong) {
            out.fix(
                "ko.word.ryul",
                a,
                b,
                right,
                format!("모음이나 ㄴ 뒤에서는 ‘율’로 씁니다: ‘{right}’."),
            );
        }
    }
}

static DATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"((?:19|20)\d{2})\.\s?(\d{1,2})\.\s?(\d{1,2})(\.?)").unwrap());

/// ko.date.format: 2026.10.14 or a missing final period -> 2026. 10. 14.
/// Versions and IP addresses don't have a 4-digit year with a valid month
/// and day, or go on with another number.
fn date_format(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&DATE) {
        let (Some((a, b)), Some(y), Some(mo), Some(d)) = (caps[0], caps[1], caps[2], caps[3])
        else {
            continue;
        };
        if t.before(a).is_some_and(|c| c.is_ascii_digit() || c == '.')
            || t.at(b).is_some_and(|c| c.is_ascii_digit())
        {
            continue;
        }
        let month: u32 = t.slice(mo.0, mo.1).parse().unwrap_or(0);
        let day: u32 = t.slice(d.0, d.1).parse().unwrap_or(0);
        if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
            continue;
        }
        let fixed = format!("{}. {}. {}.", t.slice(y.0, y.1), month, day);
        out.fix(
            "ko.date.format",
            a,
            b,
            fixed,
            "날짜는 ‘2026. 10. 14.’처럼 마침표를 찍고 띄어 씁니다.",
        );
    }
}

/// ko.punct.colon-space: `장소 : 광화문` / `장소:광화문` -> `장소: 광화문`.
/// Times, ratios and chapter:verse (digits on both sides) stay.
fn colon_space(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for i in 0..t.len() {
        if t.chars[i] != ':' {
            continue;
        }
        let mut a = i;
        while a > 0 && t.chars[a - 1] == ' ' {
            a -= 1;
        }
        let Some(before) = a.checked_sub(1).map(|k| t.chars[k]) else {
            continue;
        };
        if !is_hangul(before) {
            continue;
        }
        let mut b = i + 1;
        while b < t.len() && t.chars[b] == ' ' {
            b += 1;
        }
        let Some(after) = t.at(b) else { continue };
        if after.is_ascii_digit() && before.is_ascii_digit() {
            continue;
        }
        if a == i && b == i + 2 {
            continue; // already `X: Y`
        }
        if !(is_hangul(after) || after.is_alphanumeric()) {
            continue;
        }
        out.fix(
            "ko.punct.colon-space",
            a - 1,
            b + 1,
            format!("{before}: {after}"),
            "쌍점(:)은 앞말에 붙이고 뒤는 띄어 씁니다.",
        );
    }
}

static DOUBLE_PASSIVE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:보여|잊혀|불려|되어|쓰여|읽혀|짜여|믿겨)(?:지|진|져|졌)").unwrap()
});

/// ko.word.double-passive: 보여지다, 잊혀지다... - a hint (some accept -어지다
/// as resultative).
fn double_passive(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, b) in t.find(&DOUBLE_PASSIVE) {
        out.flag(
            "ko.word.double-passive",
            a,
            b,
            "이중 피동 표현입니다: ‘보이다’, ‘잊히다’처럼 써 보세요.",
        );
    }
}

static THING_HONORIFIC: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:커피|음료|음식|주문하신\s?\S+|메뉴|가격|사이즈|물건|상품)\S{0,3}\s(?:나오셨|있으시|없으시|되시)|원이세요|품절이세요").unwrap()
});

/// ko.honorific.thing: honorifics for things (커피 나오셨습니다).
fn honorific_thing(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, b) in t.find(&THING_HONORIFIC) {
        out.flag(
            "ko.honorific.thing",
            a,
            b,
            "사물을 높이는 표현입니다: ‘커피 나왔습니다’처럼 씁니다.",
        );
    }
}

static FORMAL_END: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:습니다|ㅂ니다|십시오|습니까|입니다|합니다|됩니다)[.?!]").unwrap()
});
static POLITE_END: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\p{Hangul}(?:요|죠)[.?!]").unwrap());

/// ko.style.register-mix: 하십시오체 and 해요체 mixed in one document - the
/// minority flagged; not quotations or dialogue.
fn register_mix(t: &Text, ctx: &Ctx, out: &mut Out) {
    if matches!(
        ctx.block,
        Block::Heading(_) | Block::ListItem | Block::Quote
    ) {
        return;
    }
    let s = ctx.stats;
    let (re, msg) = if minority(s.ko_polite, s.ko_formal) {
        (
            &*POLITE_END,
            "하십시오체와 해요체가 섞여 있습니다(본문은 대부분 하십시오체).",
        )
    } else if minority(s.ko_formal, s.ko_polite) {
        (
            &*FORMAL_END,
            "하십시오체와 해요체가 섞여 있습니다(본문은 대부분 해요체).",
        )
    } else {
        return;
    };
    for (a, b) in t.find(re) {
        let mut a = a;
        while a > 0 && is_hangul(t.chars[a - 1]) {
            a -= 1;
        }
        if !t.in_quotes(a, b) {
            out.flag("ko.style.register-mix", a, b - 1, msg);
        }
    }
}

static AFTERNOON: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(오전|오후)\s?(\d{1,2})시(?:\s?(\d{1,2})분)?").unwrap());

/// ko.official.* (ko/official): times in 24-hour form, `끝.` at the end.
fn official(t: &Text, ctx: &Ctx, out: &mut Out) {
    if !ctx.profile.is("official") {
        return;
    }
    for caps in t.captures(&AFTERNOON) {
        let (Some((a, b)), Some(ap), Some(h)) = (caps[0], caps[1], caps[2]) else {
            continue;
        };
        let mut hour: u32 = t.slice(h.0, h.1).parse().unwrap_or(0);
        if t.slice(ap.0, ap.1) == "오후" && hour < 12 {
            hour += 12;
        }
        let minute: u32 = caps[3]
            .map(|m| t.slice(m.0, m.1).parse().unwrap_or(0))
            .unwrap_or(0);
        out.fix(
            "ko.official.format",
            a,
            b,
            format!("{hour:02}:{minute:02}"),
            "공문서의 시각은 24시각제로 ‘15:00’처럼 씁니다.",
        );
    }
}

#[cfg(test)]
mod tests {
    use super::super::testing::*;
    use super::super::Lang;

    const K: Lang = Lang::Ko;

    #[test]
    fn particles_attach_but_units_and_quotes_stay() {
        assert_eq!(
            fixed(
                "ko.space.particle",
                K,
                None,
                "API 를 호출하고 v2 에서 확인했다."
            ),
            "API를 호출하고 v2에서 확인했다."
        );
        for ok in [
            "사과 3 개를 샀다",
            "기온이 30 도 이상",
            "“좋아” 하고 웃었다",
            "API 문서를 봤다",
        ] {
            assert!(hits("ko.space.particle", K, None, ok).is_empty(), "{ok}");
        }
    }

    #[test]
    fn marks_and_spelling_lists() {
        assert_eq!(
            fixed("ko.punct.cjk-marks", K, None, "좋습니다。그리고、"),
            "좋습니다.그리고,"
        );
        assert_eq!(
            fixed("ko.word.myeochil", K, None, "몇일 걸려요?"),
            "며칠 걸려요?"
        );
        assert_eq!(
            fixed("ko.word.dwae", K, None, "안되요. 다 됬다."),
            "안돼요. 다 됐다."
        );
        assert_eq!(
            fixed("ko.word.saisiot", K, None, "햇님과 갯수"),
            "해님과 개수"
        );
        assert_eq!(
            fixed("ko.word.ryul", K, None, "실패률과 할인률"),
            "실패율과 할인율"
        );
        // 합격률 is right (률 after a consonant).
        assert!(hits("ko.word.ryul", K, None, "합격률").is_empty());
    }

    #[test]
    fn dates_colons_and_hints() {
        assert_eq!(
            fixed("ko.date.format", K, None, "날짜: 2026.10.14 오전"),
            "날짜: 2026. 10. 14. 오전"
        );
        assert!(hits("ko.date.format", K, None, "버전 2026.10.14.3과 192.168.0.1").is_empty());
        assert!(hits("ko.date.format", K, None, "2026. 10. 14. 회의").is_empty());
        assert_eq!(
            fixed("ko.punct.colon-space", K, None, "장소 : 광화문, 일시:내일"),
            "장소: 광화문, 일시: 내일"
        );
        assert!(hits("ko.punct.colon-space", K, None, "10:20에 만나고 3:16 구절").is_empty());
        assert_eq!(
            hits("ko.word.double-passive", K, None, "잊혀진 계절").len(),
            1
        );
        assert_eq!(
            hits("ko.honorific.thing", K, None, "주문하신 커피 나오셨습니다.").len(),
            1
        );
    }

    #[test]
    fn register_and_official_profile() {
        let text = "확인했습니다. 진행합니다. 완료됩니다. 좋아요.";
        assert_eq!(
            hits("ko.style.register-mix", K, None, text),
            flagged("좋아요")
        );
        assert_eq!(
            fixed(
                "ko.official.format",
                K,
                Some("ko/official"),
                "오후 3시 30분에 시작"
            ),
            "15:30에 시작"
        );
        assert!(hits("ko.official.format", K, None, "오후 3시").is_empty());
    }

    #[test]
    fn never_flag_in_korean() {
        let text = "비가 와서, 우리는 3 개를 샀고... 1,000원(?)이었다… “네” 하고 답했다.";
        let all = findings(K, None, text, super::super::Block::Paragraph);
        assert!(all.is_empty(), "{all:?}");
    }
}
