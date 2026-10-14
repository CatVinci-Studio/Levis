//! The automatic half of the live evaluation's judgement: which language a
//! text is in, what Markdown structure a document has, and what a set of
//! accepted `propose_edit` calls does to the document. All pure and cheap -
//! the unit tests at the bottom run in CI, so the checks themselves can't
//! silently rot while the live tests that use them sit ignored.

use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use std::collections::BTreeMap;

// ------------------------------------------------------------------ language

/// The languages the matrix writes documents and requests in. `Mixed` is
/// Chinese prose carrying English terms - judged as Chinese, with the
/// English terms expected to survive.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lang {
    En,
    ZhHans,
    ZhHant,
    Ja,
    Ko,
    Es,
    Fr,
    De,
    Ru,
    Pt,
    Mixed,
}

impl Lang {
    pub fn code(self) -> &'static str {
        match self {
            Lang::En => "en",
            Lang::ZhHans => "zh-Hans",
            Lang::ZhHant => "zh-Hant",
            Lang::Ja => "ja",
            Lang::Ko => "ko",
            Lang::Es => "es",
            Lang::Fr => "fr",
            Lang::De => "de",
            Lang::Ru => "ru",
            Lang::Pt => "pt",
            Lang::Mixed => "zh+en",
        }
    }

    /// What a reply or an edit in this language is detected as - mixed
    /// Chinese/English text is Chinese text.
    fn detected_as(self) -> Lang {
        match self {
            Lang::Mixed => Lang::ZhHans,
            other => other,
        }
    }
}

/// Characters that exist in only one of the two Chinese scripts, in pairs
/// (simplified, traditional) - common enough that any real paragraph has a
/// few. Used to tell zh-Hans from zh-Hant, which script ratios can't.
const HANS_HANT: &[(char, char)] = &[
    ('们', '們'),
    ('这', '這'),
    ('个', '個'),
    ('说', '說'),
    ('为', '為'),
    ('学', '學'),
    ('国', '國'),
    ('时', '時'),
    ('会', '會'),
    ('来', '來'),
    ('对', '對'),
    ('发', '發'),
    ('经', '經'),
    ('过', '過'),
    ('还', '還'),
    ('见', '見'),
    ('长', '長'),
    ('门', '門'),
    ('问', '問'),
    ('开', '開'),
    ('关', '關'),
    ('买', '買'),
    ('东', '東'),
    ('车', '車'),
    ('电', '電'),
    ('话', '話'),
    ('体', '體'),
    ('点', '點'),
    ('变', '變'),
    ('让', '讓'),
    ('从', '從'),
    ('后', '後'),
    ('里', '裡'),
    ('与', '與'),
    ('实', '實'),
    ('现', '現'),
    ('观', '觀'),
    ('应', '應'),
    ('该', '該'),
    ('样', '樣'),
    ('间', '間'),
    ('题', '題'),
    ('结', '結'),
    ('论', '論'),
    ('议', '議'),
    ('认', '認'),
    ('识', '識'),
    ('历', '歷'),
    ('区', '區'),
    ('页', '頁'),
    ('写', '寫'),
    ('读', '讀'),
    ('书', '書'),
    ('图', '圖'),
    ('数', '數'),
    ('据', '據'),
    ('计', '計'),
    ('划', '劃'),
    ('试', '試'),
    ('验', '驗'),
    ('价', '價'),
    ('钱', '錢'),
    ('业', '業'),
    ('产', '產'),
    ('统', '統'),
    ('级', '級'),
    ('网', '網'),
    ('络', '絡'),
    ('报', '報'),
    ('告', '告'),
];

/// Word lists for telling the Latin-script languages apart, weighted
/// towards words that are frequent in one language and rare in the others.
const LATIN_WORDS: &[(Lang, &[&str])] = &[
    (
        Lang::En,
        &[
            "the", "and", "of", "to", "is", "that", "it", "with", "for", "this", "are", "was",
            "be", "on", "not", "you", "have", "we", "they", "which", "will", "from", "but",
        ],
    ),
    (
        Lang::Es,
        &[
            "el", "los", "las", "y", "del", "una", "es", "con", "se", "más", "pero", "muy", "pues",
            "aquí", "también", "está", "están", "sus", "hay", "fue", "este", "la", "lo", "por",
            "su", "al",
        ],
    ),
    (
        Lang::Fr,
        &[
            "le", "les", "des", "et", "est", "une", "pour", "dans", "pas", "sur", "du", "avec",
            "au", "ce", "qui", "nous", "vous", "sont", "mais", "plus", "être", "cette", "aux",
        ],
    ),
    (
        Lang::De,
        &[
            "der", "die", "das", "und", "ist", "nicht", "ein", "eine", "zu", "mit", "den", "von",
            "auf", "für", "sich", "dem", "auch", "wir", "es", "sind", "wird", "werden",
        ],
    ),
    (
        Lang::Pt,
        &[
            "os", "do", "da", "em", "um", "uma", "não", "é", "com", "dos", "das", "mais", "mas",
            "como", "também", "são", "está", "foi", "pelo", "pela", "nos", "ao", "seu", "e", "ali",
            "depois", "isso", "muito", "ainda", "o", "na", "você", "pra", "seus", "suas",
        ],
    ),
];

#[derive(Default, Debug)]
struct ScriptCounts {
    han: usize,
    kana: usize,
    hangul: usize,
    cyrillic: usize,
    latin: usize,
}

fn script_counts(text: &str) -> ScriptCounts {
    let mut c = ScriptCounts::default();
    for ch in text.chars() {
        match ch {
            '\u{4e00}'..='\u{9fff}' | '\u{3400}'..='\u{4dbf}' => c.han += 1,
            '\u{3040}'..='\u{30ff}' => c.kana += 1,
            '\u{ac00}'..='\u{d7af}' | '\u{1100}'..='\u{11ff}' => c.hangul += 1,
            '\u{0400}'..='\u{04ff}' => c.cyrillic += 1,
            c2 if c2.is_alphabetic()
                && (c2.is_ascii() || ('\u{00c0}'..='\u{024f}').contains(&c2)) =>
            {
                c.latin += 1
            }
            _ => {}
        }
    }
    c
}

/// Prose only: code spans and fences, URLs, and Markdown punctuation say
/// nothing about the language and would skew every ratio towards Latin.
fn prose_only(text: &str) -> String {
    let mut out = String::new();
    let mut in_fence = false;
    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let mut in_code = false;
        for (i, part) in line.split('`').enumerate() {
            if i > 0 {
                in_code = !in_code;
            }
            if !in_code {
                for word in part.split_whitespace() {
                    if !word.contains("://") && !word.starts_with("$") {
                        out.push_str(word);
                        out.push(' ');
                    }
                }
            }
        }
        out.push('\n');
    }
    out
}

/// Best guess at the language of `text`, or None when there is too little
/// prose to tell (a number, a single name).
pub fn detect(text: &str) -> Option<Lang> {
    let prose = prose_only(text);
    let c = script_counts(&prose);
    let cjk = c.han + c.kana;
    let total = cjk + c.hangul + c.cyrillic + c.latin;
    if total < 6 {
        return None;
    }
    if c.hangul * 3 > total {
        return Some(Lang::Ko);
    }
    // Japanese mixes kanji with kana; even kanji-heavy prose has particles.
    if c.kana >= 3 && c.kana * 8 > cjk {
        return Some(Lang::Ja);
    }
    // CJK characters carry roughly a word each, Latin letters a fifth of
    // one - so Chinese with English terms still counts as Chinese.
    if cjk * 5 >= c.latin && cjk >= 4 {
        let (mut hans, mut hant) = (0, 0);
        for ch in prose.chars() {
            if HANS_HANT.iter().any(|&(s, _)| s == ch) {
                hans += 1;
            }
            if HANS_HANT.iter().any(|&(_, t)| t == ch) {
                hant += 1;
            }
        }
        return Some(if hant > hans {
            Lang::ZhHant
        } else {
            Lang::ZhHans
        });
    }
    if c.cyrillic > c.latin {
        return Some(Lang::Ru);
    }
    let lower = prose.to_lowercase();
    let words: Vec<&str> = lower
        .split(|ch: char| !ch.is_alphabetic())
        .filter(|w| !w.is_empty())
        .collect();
    let mut best = (Lang::En, 0.0f64);
    for (lang, list) in LATIN_WORDS {
        let mut score = words.iter().filter(|w| list.contains(w)).count() as f64;
        // Letters only one of these languages uses.
        score += match lang {
            Lang::Es => lower.matches(['ñ', '¿', '¡']).count() as f64 * 2.0,
            Lang::Pt => {
                lower.matches(['ã', 'õ']).count() as f64 * 2.0
                    + lower.matches("ção").count() as f64
                    // Digraphs Spanish doesn't have.
                    + (lower.matches("lh").count() + lower.matches("nh").count()) as f64
            }
            Lang::De => lower.matches(['ß', 'ä', 'ö', 'ü']).count() as f64 * 1.5,
            Lang::Fr => lower.matches(['è', 'ê', 'à', 'œ', 'ù', 'û']).count() as f64 * 1.5,
            _ => 0.0,
        };
        if score > best.1 {
            best = (*lang, score);
        }
    }
    Some(best.0)
}

/// Ok when `text` reads as `expected`; texts too short to tell pass.
pub fn check_lang(text: &str, expected: Lang) -> Result<(), String> {
    match detect(text) {
        None => Ok(()),
        Some(found) if found == expected.detected_as() => Ok(()),
        Some(found) => Err(format!(
            "expected {}, reads as {}",
            expected.code(),
            found.code()
        )),
    }
}

// ----------------------------------------------------------------- structure

fn markdown_options() -> Options {
    Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_MATH
        | Options::ENABLE_GFM
        | Options::ENABLE_YAML_STYLE_METADATA_BLOCKS
}

/// A document's Markdown structure with the words taken out: the block
/// tree as a token sequence (`h2`, `list`, `item`, `task`, `table[3]`,
/// `code:python`, `alert:Note`, `$$`, ...) and a count of the inline
/// constructs that carry meaning (links with their target, images, math,
/// footnote references, code spans, inline HTML).
#[derive(Debug, PartialEq, Eq, Clone, Default)]
pub struct Skeleton {
    pub blocks: Vec<String>,
    pub inline: BTreeMap<String, usize>,
}

pub fn skeleton(markdown: &str) -> Skeleton {
    let mut sk = Skeleton::default();
    let bump = |inline: &mut BTreeMap<String, usize>, key: String| {
        *inline.entry(key).or_default() += 1;
    };
    for event in Parser::new_ext(markdown, markdown_options()) {
        match event {
            Event::Start(tag) => {
                let token = match tag {
                    Tag::Paragraph => Some("p".to_string()),
                    Tag::Heading { level, .. } => Some(format!("{level}")),
                    Tag::BlockQuote(Some(kind)) => Some(format!("alert:{kind:?}")),
                    Tag::BlockQuote(None) => Some("quote".into()),
                    Tag::CodeBlock(CodeBlockKind::Fenced(lang)) => Some(format!("code:{lang}")),
                    Tag::CodeBlock(CodeBlockKind::Indented) => Some("code-indented".into()),
                    Tag::HtmlBlock => Some("html".into()),
                    Tag::List(Some(_)) => Some("olist".into()),
                    Tag::List(None) => Some("list".into()),
                    Tag::Item => Some("item".into()),
                    Tag::FootnoteDefinition(label) => Some(format!("fndef:{label}")),
                    Tag::Table(align) => Some(format!("table[{}]", align.len())),
                    Tag::TableHead => Some("thead".into()),
                    Tag::TableRow => Some("tr".into()),
                    Tag::TableCell => Some("td".into()),
                    Tag::MetadataBlock(_) => Some("frontmatter".into()),
                    Tag::Link { dest_url, .. } => {
                        bump(&mut sk.inline, format!("link:{dest_url}"));
                        None
                    }
                    Tag::Image { dest_url, .. } => {
                        bump(&mut sk.inline, format!("image:{dest_url}"));
                        None
                    }
                    _ => None,
                };
                if let Some(token) = token {
                    sk.blocks.push(token);
                }
            }
            Event::End(
                TagEnd::Paragraph
                | TagEnd::Heading(_)
                | TagEnd::BlockQuote(_)
                | TagEnd::CodeBlock
                | TagEnd::HtmlBlock
                | TagEnd::List(_)
                | TagEnd::Item
                | TagEnd::FootnoteDefinition
                | TagEnd::Table
                | TagEnd::TableHead
                | TagEnd::TableRow
                | TagEnd::TableCell
                | TagEnd::MetadataBlock(_),
            ) => sk.blocks.push("/".into()),
            Event::TaskListMarker(done) => {
                sk.blocks.push(if done { "task:x" } else { "task" }.into())
            }
            Event::DisplayMath(_) => sk.blocks.push("$$".into()),
            Event::InlineMath(_) => bump(&mut sk.inline, "math".into()),
            Event::FootnoteReference(label) => bump(&mut sk.inline, format!("fnref:{label}")),
            Event::Code(_) => bump(&mut sk.inline, "code".into()),
            Event::InlineHtml(_) => bump(&mut sk.inline, "html".into()),
            _ => {}
        }
    }
    sk
}

/// What an edit is allowed to do to the document's structure.
#[derive(Clone, Copy, Debug, Default)]
pub enum StructureExpect {
    /// Not checked - free-form additions (a new section, a continuation).
    #[default]
    Any,
    /// The block tree is unchanged: a rewrite inside existing blocks.
    Same,
    /// The block tree is unchanged except for these token count changes,
    /// e.g. `[("tr", 1), ("td", 3)]` for a new table row.
    Delta(&'static [(&'static str, i64)]),
}

pub fn check_structure(
    before: &Skeleton,
    after: &Skeleton,
    expect: StructureExpect,
) -> Result<(), String> {
    let counts = |sk: &Skeleton| {
        let mut m: BTreeMap<String, i64> = BTreeMap::new();
        for b in &sk.blocks {
            *m.entry(b.clone()).or_default() += 1;
        }
        m
    };
    match expect {
        StructureExpect::Any => Ok(()),
        StructureExpect::Same if before.blocks == after.blocks => Ok(()),
        StructureExpect::Same => Err(format!(
            "block structure changed: {}",
            count_diff(&counts(before), &counts(after))
        )),
        StructureExpect::Delta(delta) => {
            let mut want = counts(before);
            for (token, d) in delta {
                *want.entry(token.to_string()).or_default() += d;
            }
            want.retain(|_, v| *v != 0);
            let got = counts(after);
            if want == got {
                Ok(())
            } else {
                Err(format!(
                    "block structure is not the expected change: {}",
                    count_diff(&want, &got)
                ))
            }
        }
    }
}

fn count_diff(want: &BTreeMap<String, i64>, got: &BTreeMap<String, i64>) -> String {
    let mut parts = Vec::new();
    for key in want
        .keys()
        .chain(got.keys())
        .collect::<std::collections::BTreeSet<_>>()
    {
        let (w, g) = (
            want.get(key).copied().unwrap_or(0),
            got.get(key).copied().unwrap_or(0),
        );
        if w != g {
            parts.push(format!("{key} {w}->{g}"));
        }
    }
    parts.join(", ")
}

/// Inline constructs (links, math, footnote refs, code spans) present
/// before but missing after - formatting an edit silently dropped.
pub fn lost_inline(before: &Skeleton, after: &Skeleton) -> Vec<String> {
    before
        .inline
        .iter()
        .filter(|(k, n)| after.inline.get(*k).copied().unwrap_or(0) < **n)
        .map(|(k, _)| k.clone())
        .collect()
}

// --------------------------------------------------------------------- edits

/// One accepted `propose_edit` call's arguments.
#[derive(Clone, Debug, Default)]
pub struct Proposal {
    pub action: String,
    pub anchor: String,
    pub text: String,
    pub context: String,
}

impl Proposal {
    pub fn from_json(v: &serde_json::Value) -> Proposal {
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
        Proposal {
            action: s("action"),
            anchor: s("anchor"),
            text: s("text"),
            context: s("context"),
        }
    }
}

/// Where the user's cursor or selection was when they sent the message, as
/// byte offsets into the document markdown - what insert_at_cursor and
/// replace_selection act on.
#[derive(Clone, Copy, Debug, Default)]
pub struct Caret {
    pub cursor: Option<usize>,
    pub selection: Option<(usize, usize)>,
}

/// Mirrors tools.rs's normalize_char / doc-markdown.ts's normalizeForMatch.
fn normalize_char(c: char) -> char {
    match c {
        '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{2032}' => '\'',
        '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{2033}' => '"',
        '\u{2010}'..='\u{2015}' | '\u{2212}' => '-',
        '\u{00A0}' | '\u{2007}' | '\u{202F}' | '\u{3000}' => ' ',
        '\u{FF01}'..='\u{FF5E}' => char::from_u32(c as u32 - 0xFEE0).unwrap_or(c),
        _ => c,
    }
}

fn unique_index(haystack: &str, needle: &str) -> Option<usize> {
    if needle.is_empty() {
        return None;
    }
    let mut it = haystack.match_indices(needle);
    let (first, _) = it.next()?;
    it.next().is_none().then_some(first)
}

/// Byte range of the one place `anchor` targets - the same resolution order
/// as doc-markdown.ts's findMarkdownMatch: exact, then through `context`,
/// then typography-normalized, then whitespace-folded.
pub fn locate(doc: &str, anchor: &str, context: &str) -> Option<(usize, usize)> {
    if let Some(i) = unique_index(doc, anchor) {
        return Some((i, i + anchor.len()));
    }
    if context.len() > anchor.len() {
        if let (Some(inner), Some(start)) = (context.find(anchor), unique_index(doc, context)) {
            return Some((start + inner, start + inner + anchor.len()));
        }
    }
    if doc.contains(anchor) {
        return None; // repeated and no usable context
    }
    // Normalization is one char to one char, so char indices carry over;
    // byte offsets are mapped back through the original's char_indices.
    let doc_chars: Vec<(usize, char)> = doc.char_indices().collect();
    let norm_doc: String = doc_chars.iter().map(|&(_, c)| normalize_char(c)).collect();
    let norm_anchor: String = anchor.chars().map(normalize_char).collect();
    let byte_at = |char_idx: usize| doc_chars.get(char_idx).map_or(doc.len(), |&(b, _)| b);
    let to_char = |s: &str, byte: usize| s[..byte].chars().count();
    if let Some(i) = unique_index(&norm_doc, &norm_anchor) {
        let start = to_char(&norm_doc, i);
        return Some((byte_at(start), byte_at(start + norm_anchor.chars().count())));
    }
    if norm_doc.contains(&norm_anchor) {
        return None;
    }
    // Whitespace-folded: the anchor's words in order, any whitespace run
    // between them, matching exactly once.
    let tokens: Vec<&str> = norm_anchor.split_whitespace().collect();
    if tokens.len() < 2 {
        return None;
    }
    let mut found = None;
    for (i, _) in norm_doc.match_indices(tokens[0]) {
        let mut pos = i + tokens[0].len();
        let mut ok = true;
        for token in &tokens[1..] {
            let rest = &norm_doc[pos..];
            let ws = rest.len() - rest.trim_start().len();
            if ws == 0 || !rest[ws..].starts_with(token) {
                ok = false;
                break;
            }
            pos += ws + token.len();
        }
        if ok {
            if found.is_some() {
                return None;
            }
            found = Some((i, pos));
        }
    }
    found.map(|(s, e)| {
        (
            byte_at(to_char(&norm_doc, s)),
            byte_at(to_char(&norm_doc, e)),
        )
    })
}

/// Top-level block byte ranges - the frontend's MarkdownBlock boundaries,
/// which decide whether an insertion joins a sentence or starts a block.
fn top_level_blocks(doc: &str) -> Vec<(usize, usize)> {
    let mut blocks = Vec::new();
    let mut depth = 0usize;
    for (event, range) in Parser::new_ext(doc, markdown_options()).into_offset_iter() {
        match event {
            Event::Start(_) => {
                if depth == 0 {
                    blocks.push((range.start, range.end));
                }
                depth += 1;
            }
            Event::End(_) => depth = depth.saturating_sub(1),
            _ if depth == 0 => blocks.push((range.start, range.end)),
            _ => {}
        }
    }
    blocks
}

fn block_around(doc: &str, start: usize, end: usize) -> (usize, usize) {
    let blocks = top_level_blocks(doc);
    let first = blocks
        .iter()
        .rev()
        .find(|b| b.0 <= start)
        .copied()
        .unwrap_or((0, doc.len()));
    let last = blocks
        .iter()
        .rev()
        .find(|b| b.0 < end.max(start + 1))
        .copied()
        .unwrap_or(first);
    (first.0, last.1.max(first.1).min(doc.len()))
}

/// Mirrors doc-markdown.ts's isBlockText.
fn is_block_text(text: &str) -> bool {
    let t = text.trim();
    let starts_block = t.starts_with('>')
        || t.starts_with("```")
        || t.starts_with("~~~")
        || t.starts_with('|')
        || t.starts_with("- ")
        || t.starts_with("* ")
        || t.starts_with("+ ")
        || {
            let hashes = t.chars().take_while(|&c| c == '#').count();
            (1..=6).contains(&hashes) && t[hashes..].starts_with(' ')
        }
        || {
            let digits = t.chars().take_while(|c| c.is_ascii_digit()).count();
            digits > 0 && (t[digits..].starts_with(". ") || t[digits..].starts_with(") "))
        };
    starts_block || t.contains("\n\n") || t.contains("\n \n")
}

/// Mirrors doc-markdown.ts's isParagraph: one plain paragraph, the only
/// block a sentence carries on past the edge of.
fn is_paragraph(markdown: &str) -> bool {
    let t = markdown.trim_start();
    !is_block_text(markdown) && !["<", "$$", "[^", "---"].iter().any(|p| t.starts_with(p))
}

fn is_cjk(c: char) -> bool {
    matches!(c, '\u{3000}'..='\u{9fff}' | '\u{ac00}'..='\u{d7af}' | '\u{ff00}'..='\u{ffef}')
}

/// Mirrors doc-markdown.ts's sameLineKind: rows of one table or items of
/// one list, which join with a single newline.
fn same_line_kind(a: &str, b: &str) -> bool {
    let row = |l: &str| l.trim_start().starts_with('|');
    let item = |l: &str| {
        let t = l.trim_start();
        t.starts_with("- ") || t.starts_with("* ") || t.starts_with("+ ") || {
            let d = t.chars().take_while(|c| c.is_ascii_digit()).count();
            d > 0 && (t[d..].starts_with(". ") || t[d..].starts_with(") "))
        }
    };
    (row(a) && row(b)) || (item(a) && item(b))
}

/// Mirrors doc-markdown.ts's trimLines: no blank lines around the text,
/// its first line's indentation kept.
fn trim_lines(text: &str) -> String {
    let lead = text.len() - text.trim_start().len();
    let start = text[..lead].rfind('\n').map_or(0, |i| i + 1);
    text[start..].trim_end().to_string()
}

/// Mirrors doc-markdown.ts's joinInline.
fn join_inline(left: &str, right: &str) -> String {
    let (a, b) = (left.chars().last(), right.chars().next());
    match (a, b) {
        (Some(a), Some(b))
            if !a.is_whitespace()
                && !b.is_whitespace()
                && !is_cjk(a)
                && !is_cjk(b)
                && !".,;:!?)]}".contains(b) =>
        {
            format!("{left} {right}")
        }
        _ => format!("{left}{right}"),
    }
}

/// Mirrors apply-edit.ts's normalizeAiMarkdown.
fn normalize_bullets(text: &str) -> String {
    text.lines()
        .map(|line| {
            let indent = line.len() - line.trim_start().len();
            let rest = &line[indent..];
            match rest.chars().next() {
                Some('•' | '●' | '◦' | '·')
                    if rest.chars().nth(1).is_some_and(char::is_whitespace) =>
                {
                    let skip = rest.chars().next().unwrap().len_utf8();
                    format!("{}- {}", &line[..indent], rest[skip..].trim_start())
                }
                _ => line.to_string(),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The byte range one proposal replaces and what it puts there.
fn resolve(doc: &str, p: &Proposal, caret: Caret) -> Result<(usize, usize, String), String> {
    let text = normalize_bullets(&p.text);
    match p.action.as_str() {
        "append" => {
            let end = doc.trim_end().len();
            Ok((end, end, format!("\n\n{}", text.trim())))
        }
        "replace_selection" => {
            let (s, e) = caret
                .selection
                .ok_or("replace_selection without a selection")?;
            Ok((s, e, text))
        }
        "insert_at_cursor" => {
            let at = caret.cursor.ok_or("insert_at_cursor without a cursor")?;
            let rest = &doc[at..];
            if is_block_text(&text) && (rest.is_empty() || rest.starts_with("\n\n")) {
                Ok((at, at, format!("\n\n{}", text.trim())))
            } else {
                let joined = join_inline(&doc[..at], &text);
                let inserted = joined[at..].to_string();
                let tail = join_inline(&inserted, rest);
                Ok((at, at, tail[..tail.len() - rest.len()].to_string()))
            }
        }
        action => {
            let (s, e) = locate(doc, &p.anchor, &p.context)
                .ok_or_else(|| format!("anchor not found exactly once: {:?}", p.anchor))?;
            let (bs, be) = block_around(doc, s, e);
            let matched = &doc[s..e];
            let prefix = &doc[bs..s];
            let suffix = &doc[e..be];
            let whole_block = prefix.trim().is_empty() && suffix.trim().is_empty();
            // Mirrors doc-markdown.ts's startsBlock for the given edge.
            let starts_block = |edge: &str| {
                is_block_text(&text)
                    || whole_block
                    || (edge.trim().is_empty() && !is_paragraph(&doc[bs..be]))
            };
            let lines = trim_lines(&text);
            let middle = match action {
                "delete" => String::new(),
                "replace" => text,
                "insert_before" => {
                    let next = format!("{matched}{suffix}");
                    let line = next.split('\n').next().unwrap_or("");
                    let at_line_start = prefix.is_empty() || prefix.ends_with('\n');
                    if at_line_start && same_line_kind(lines.lines().last().unwrap_or(""), line) {
                        format!("{lines}\n{matched}")
                    } else if starts_block(prefix) {
                        format!("{}\n\n{matched}", text.trim())
                    } else {
                        join_inline(&text, matched)
                    }
                }
                "insert_after" => {
                    let prev = format!("{prefix}{matched}");
                    let line = prev.rsplit('\n').next().unwrap_or("");
                    let at_line_end = suffix.is_empty() || suffix.starts_with('\n');
                    if at_line_end && same_line_kind(line, lines.lines().next().unwrap_or("")) {
                        format!("{matched}\n{lines}")
                    } else if starts_block(suffix) {
                        format!("{matched}\n\n{}", text.trim())
                    } else {
                        join_inline(matched, &text)
                    }
                }
                other => return Err(format!("unknown action {other}")),
            };
            Ok((s, e, middle))
        }
    }
}

/// The document after the user accepts every proposal - each resolved
/// against the document the model saw (as the frontend's previews are),
/// then written back to front. Overlapping proposals are an error: the
/// frontend would show both and accepting one would invalidate the other.
pub fn apply_all(doc: &str, proposals: &[Proposal], caret: Caret) -> Result<String, String> {
    let mut spans = proposals
        .iter()
        .map(|p| resolve(doc, p, caret))
        .collect::<Result<Vec<_>, _>>()?;
    spans.sort_by_key(|s| (s.0, s.1));
    for pair in spans.windows(2) {
        if pair[1].0 < pair[0].1 {
            return Err("two proposals overlap".into());
        }
    }
    let mut out = doc.to_string();
    for (s, e, text) in spans.into_iter().rev() {
        out.replace_range(s..e, &text);
    }
    Ok(out)
}

/// The changed span between two versions: (start, end in `a`, end in `b`),
/// trimmed to char boundaries. Everything outside it is byte-identical.
pub fn changed_span(a: &str, b: &str) -> (usize, usize, usize) {
    let mut p = a.bytes().zip(b.bytes()).take_while(|(x, y)| x == y).count();
    while !a.is_char_boundary(p) || !b.is_char_boundary(p) {
        p -= 1;
    }
    let max_s = a.len().min(b.len()) - p;
    let mut s = a
        .bytes()
        .rev()
        .zip(b.bytes().rev())
        .take(max_s)
        .take_while(|(x, y)| x == y)
        .count();
    while !a.is_char_boundary(a.len() - s) || !b.is_char_boundary(b.len() - s) {
        s -= 1;
    }
    (p, a.len() - s, b.len() - s)
}

/// Ok when every changed byte of `before` lies inside the one occurrence of
/// `region` - the passage the request was about.
pub fn check_region(before: &str, after: &str, region: &str) -> Result<(), String> {
    if before == after {
        return Ok(());
    }
    let start = before
        .find(region)
        .ok_or_else(|| "case error: region not in document".to_string())?;
    let end = start + region.len();
    let (s, e, _) = changed_span(before, after);
    // The line breaks around the region count as inside: a row added after
    // a table's last row shows up as a change just past its newline.
    let start = before[..start].strip_suffix('\n').map_or(start, str::len);
    let end = end + usize::from(before[end..].starts_with('\n'));
    if s >= start && e <= end {
        Ok(())
    } else {
        let line = |at: usize| before[..at].lines().count().max(1);
        Err(format!(
            "changed lines {}-{} outside the target (lines {}-{})",
            line(s),
            line(e),
            line(start),
            line(end)
        ))
    }
}

/// Character-level similarity (bigram Dice) - for "are these candidates
/// actually different" and "did the edit change more than it needed".
pub fn similarity(a: &str, b: &str) -> f64 {
    let grams = |s: &str| {
        let chars: Vec<char> = s.chars().filter(|c| !c.is_whitespace()).collect();
        let mut m: BTreeMap<(char, char), usize> = BTreeMap::new();
        for w in chars.windows(2) {
            *m.entry((w[0], w[1])).or_default() += 1;
        }
        m
    };
    let (ga, gb) = (grams(a), grams(b));
    let total: usize = ga.values().sum::<usize>() + gb.values().sum::<usize>();
    if total == 0 {
        return 1.0;
    }
    let common: usize = ga
        .iter()
        .map(|(k, n)| (*n).min(gb.get(k).copied().unwrap_or(0)))
        .sum();
    2.0 * common as f64 / total as f64
}

/// Prose length in "words": CJK characters count one each, other text by
/// whitespace-separated words.
pub fn word_count(text: &str) -> usize {
    let cjk = text
        .chars()
        .filter(|&c| is_cjk(c) && c.is_alphanumeric())
        .count();
    let latin = text
        .split(|c: char| c.is_whitespace() || is_cjk(c))
        .filter(|w| w.chars().any(char::is_alphanumeric))
        .count();
    cjk + latin
}

// --------------------------------------------------------------- editor text

/// Markdown as ProseMirror's `textBetween(from, to, sep)` reads it: inline
/// syntax gone (link text kept, images dropped), a hard break as "\n", and
/// `sep` between textblocks - what the editor puts in a `<cursor>` block
/// (caretContext, sep "\n") or a completion's before-text (sep "\n\n").
pub fn plain_text(markdown: &str, sep: &str) -> String {
    let mut out = String::new();
    let mut pending = false;
    let mut in_image = 0usize;
    for event in Parser::new_ext(markdown, markdown_options()) {
        match event {
            Event::Start(Tag::Image { .. }) => in_image += 1,
            Event::End(TagEnd::Image) => in_image = in_image.saturating_sub(1),
            Event::Start(
                Tag::Paragraph
                | Tag::Heading { .. }
                | Tag::CodeBlock(_)
                | Tag::Item
                | Tag::TableCell
                | Tag::BlockQuote(_)
                | Tag::FootnoteDefinition(_),
            ) => pending = true,
            Event::End(TagEnd::CodeBlock) => {
                if out.ends_with('\n') {
                    out.pop();
                }
            }
            Event::Text(t) | Event::Code(t) | Event::InlineMath(t) | Event::DisplayMath(t)
                if in_image == 0 =>
            {
                if pending && !out.is_empty() {
                    out.push_str(sep);
                }
                pending = false;
                out.push_str(&t);
            }
            Event::HardBreak => out.push('\n'),
            Event::SoftBreak => out.push(' '),
            _ => {}
        }
    }
    out
}

/// doc-markdown.ts's caretContext: up to `span` characters of plain text
/// either side of the cursor at byte `at`, blocks separated by "\n". The
/// block the cursor is in counts as the first one visited, so a cursor at a
/// block's end sees the next block after a separator, and one at a block's
/// start sees a separator after the previous block.
pub fn cursor_context(doc: &str, at: usize, span: usize) -> (String, String) {
    let (before_md, after_md) = doc.split_at(at);
    let mut before = plain_text(before_md, "\n");
    if before_md.ends_with('\n') && !before.is_empty() {
        before.push('\n');
    }
    // Markdown drops a paragraph's edge spaces; at the cursor they are
    // real text.
    let trailing = &before_md[before_md.trim_end_matches([' ', '\t']).len()..];
    before.push_str(trailing);
    let mut after = plain_text(after_md, "\n");
    if after_md.starts_with('\n') && !after.is_empty() {
        after.insert(0, '\n');
    }
    let leading = &after_md[..after_md.len() - after_md.trim_start_matches([' ', '\t']).len()];
    after.insert_str(0, leading);
    let n = before.chars().count();
    (
        before.chars().skip(n.saturating_sub(span)).collect(),
        after.chars().take(span).collect(),
    )
}

/// One inline formatting range in a paragraph's text (char offsets).
#[derive(Clone, Debug, PartialEq)]
pub struct InlineMark {
    pub start: usize,
    pub end: usize,
    pub kind: &'static str,
}

/// A paragraph's markdown as the grammar check sees it - the block's
/// textContent - plus where each piece of inline formatting sits in that
/// text and, for every text char, its byte offset in the markdown (one
/// extra entry for the end), so fixes found in the text can be written back
/// into the markdown.
pub struct InlineText {
    pub text: String,
    pub marks: Vec<InlineMark>,
    pub md_offsets: Vec<usize>,
}

pub fn inline_text(markdown: &str) -> InlineText {
    let mut text = String::new();
    let mut marks = Vec::new();
    let mut offsets = Vec::new();
    let mut open: Vec<(&'static str, usize)> = Vec::new();
    let chars = |s: &str| s.chars().count();
    for (event, range) in Parser::new_ext(markdown, markdown_options()).into_offset_iter() {
        let is_code = matches!(event, Event::Code(_));
        match event {
            Event::Start(tag) => {
                let kind = match tag {
                    Tag::Strong => "strong",
                    Tag::Emphasis => "emphasis",
                    Tag::Strikethrough => "strike",
                    Tag::Link { .. } => "link",
                    _ => continue,
                };
                open.push((kind, chars(&text)));
            }
            Event::End(
                TagEnd::Strong | TagEnd::Emphasis | TagEnd::Strikethrough | TagEnd::Link,
            ) => {
                if let Some((kind, start)) = open.pop() {
                    marks.push(InlineMark {
                        start,
                        end: chars(&text),
                        kind,
                    });
                }
            }
            Event::Text(t) | Event::Code(t) => {
                let source = &markdown[range.clone()];
                let base = if is_code {
                    range.start + source.find(&*t).unwrap_or(0)
                } else if source == &*t {
                    range.start
                } else {
                    // An escape or entity: the chars don't line up one to
                    // one; pin them all to the start of the source.
                    for _ in t.chars() {
                        offsets.push(range.start);
                    }
                    text.push_str(&t);
                    continue;
                };
                let start = chars(&text);
                for (i, _) in t.char_indices() {
                    offsets.push(base + i);
                }
                text.push_str(&t);
                if is_code {
                    marks.push(InlineMark {
                        start,
                        end: chars(&text),
                        kind: "code",
                    });
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                offsets.push(range.start);
                text.push('\n');
            }
            _ => {}
        }
    }
    offsets.push(markdown.trim_end().len());
    marks.sort_by_key(|m| (m.start, m.end));
    InlineText {
        text,
        marks,
        md_offsets: offsets,
    }
}

impl InlineText {
    /// Byte offset in the markdown just past text char `i` (exclusive end).
    fn md_end(&self, markdown: &str, end: usize) -> usize {
        if end == 0 {
            return self.md_offsets.first().copied().unwrap_or(0);
        }
        let last = self.md_offsets[end - 1];
        last + markdown[last..].chars().next().map_or(0, char::len_utf8)
    }

    /// The markdown with text-space edits (char start, char end,
    /// replacement) written back into it, back to front.
    pub fn apply_to_markdown(
        &self,
        markdown: &str,
        edits: &[(usize, usize, String)],
    ) -> Result<String, String> {
        let mut sorted: Vec<&(usize, usize, String)> = edits.iter().collect();
        sorted.sort_by_key(|e| e.0);
        let mut out = markdown.to_string();
        for (s, e, replacement) in sorted.into_iter().rev() {
            if *e > self.md_offsets.len() - 1 || s > e {
                return Err(format!("edit {s}..{e} outside the text"));
            }
            let ms = self.md_offsets[*s];
            let me = if e == s {
                ms
            } else {
                self.md_end(markdown, *e)
            };
            out.replace_range(ms..me, replacement);
        }
        Ok(out)
    }

    /// Edits that would split or straddle a formatting range (part inside,
    /// part outside), or touch inline code at all - accepting one damages
    /// the author's formatting.
    pub fn damaging(&self, edits: &[(usize, usize)]) -> Vec<String> {
        let mut out = Vec::new();
        for &(s, e) in edits {
            for m in &self.marks {
                let overlaps = s < m.end && e > m.start;
                let inside = s >= m.start && e <= m.end;
                if overlaps && (m.kind == "code" || !inside) {
                    let span: String = self.text.chars().skip(s).take(e - s).collect();
                    out.push(format!(
                        "{span:?} crosses {} {}..{}",
                        m.kind, m.start, m.end
                    ));
                }
            }
        }
        out
    }
}

/// The whole lines from the one containing `start` through the first line
/// after it containing `end` - a table or list region, whatever padding the
/// editor gave its rows.
pub fn lines_between(doc: &str, start: &str, end: &str) -> String {
    let a = doc.find(start).expect("region start");
    let a = doc[..a].rfind('\n').map_or(0, |i| i + 1);
    let b = a + doc[a..].find(end).expect("region end");
    let b = doc[b..].find('\n').map_or(doc.len(), |i| b + i);
    doc[a..b].to_string()
}

/// The trimmed cells of the table row whose first cell is `first`.
pub fn table_row(doc: &str, first: &str) -> Option<Vec<String>> {
    doc.lines().find_map(|line| {
        let t = line.trim();
        let cells: Vec<String> = t
            .strip_prefix('|')?
            .strip_suffix('|')?
            .split('|')
            .map(|c| c.trim().to_string())
            .collect();
        (cells.first().map(String::as_str) == Some(first)).then_some(cells)
    })
}

pub fn row_cells_are(doc: &str, first: &str, want: &[&str]) -> Result<(), String> {
    match table_row(doc, first) {
        Some(cells) if cells == want => Ok(()),
        Some(cells) => Err(format!("row reads {cells:?}")),
        None => Err(format!("no row starting with {first:?}")),
    }
}

// --------------------------------------------------------------- completion

/// Text the suggestion repeats from just before the cursor, as the user
/// would read it once accepted: "常備" + "常備薬" reads 常備常備薬, "Lessons
/// from" + " Lessons from a..." reads the heading twice. Two or more
/// characters of an unspaced script, or four or more otherwise.
pub fn doubled_at_join(before: &str, shown: &str) -> Option<String> {
    let start = shown.trim_start();
    let chars: Vec<char> = before.trim_end().chars().collect();
    (2..=chars.len().min(40)).rev().find_map(|k| {
        let tail: String = chars[chars.len() - k..].iter().collect();
        let cjk = tail.chars().any(is_cjk);
        let enough = if cjk { k >= 2 } else { k >= 4 };
        // Mid-word tails ("ssons from") don't count - only whole words.
        let whole = !cjk
            && (chars.len() - k)
                .checked_sub(1)
                .and_then(|i| chars.get(i))
                .is_some_and(|c| c.is_alphanumeric());
        (enough && !whole && tail.chars().any(char::is_alphanumeric) && start.starts_with(&tail))
            .then_some(tail)
    })
}

/// Reasoning that leaked into a completion or grammar reply - the model
/// talking about its instructions instead of writing the text.
pub fn meta_commentary(text: &str) -> Option<&'static str> {
    let lower = text.to_lowercase();
    [
        "</reasoning",
        "<reasoning",
        "the instructions",
        "per instructions",
        "text-before-cursor",
        "the last word",
        "wait—",
        "wait -",
    ]
    .into_iter()
    .find(|m| lower.contains(m))
}

// ----------------------------------------------------------------- sentences

/// Sentences of prose (Markdown markers and code removed): split after
/// 。！？!? and after a '.' that ends a word, closing quotes kept with
/// their sentence.
pub fn sentences(markdown: &str) -> Vec<String> {
    let text = plain_text(markdown, "\n");
    let mut out = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        current.push(c);
        let ends = match c {
            '。' | '！' | '？' | '!' | '?' | '\n' => true,
            '.' => chars.get(i + 1).is_none_or(|n| n.is_whitespace()),
            _ => false,
        };
        if ends {
            while let Some(&q) = chars.get(i + 1) {
                if matches!(q, '”' | '’' | '"' | '\'' | '」' | '』' | ')' | '）') {
                    current.push(q);
                    i += 1;
                } else {
                    break;
                }
            }
            if current.trim().chars().any(char::is_alphanumeric) {
                out.push(current.trim().to_string());
            }
            current.clear();
        }
        i += 1;
    }
    if current.trim().chars().any(char::is_alphanumeric) {
        out.push(current.trim().to_string());
    }
    out
}

/// Each sentence's length: CJK characters for Chinese/Japanese text,
/// words otherwise.
pub fn sentence_lengths(markdown: &str) -> Vec<usize> {
    sentences(markdown).iter().map(|s| word_count(s)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_context_reads_like_the_editor() {
        let doc = "# Title\n\nFirst **bold** paragraph.\n\n## Next\n\nSecond one.\n";
        let at = doc.find("\n\n## Next").unwrap();
        let (b, a) = cursor_context(doc, at, 160);
        assert_eq!(b, "Title\nFirst bold paragraph.");
        assert_eq!(a, "\nNext\nSecond one.");
        let at = doc.find("Second").unwrap();
        let (b, a) = cursor_context(doc, at, 160);
        assert_eq!(b, "Title\nFirst bold paragraph.\nNext\n");
        assert_eq!(a, "Second one.");
        let (b, _) = cursor_context(doc, doc.find("paragraph").unwrap(), 6);
        assert_eq!(b, " bold ");
        assert_eq!(
            plain_text(
                "* one\n* two [link](u) ![img](p.png)\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
                "\n\n"
            ),
            "one\n\ntwo link \n\na\n\nb\n\n1\n\n2"
        );
    }

    #[test]
    fn inline_text_maps_fixes_back_into_the_markdown() {
        let md = "Run `npm instal` and read the **offical** [guide](https://x.y) first.";
        let it = inline_text(md);
        assert_eq!(it.text, "Run npm instal and read the offical guide first.");
        let kinds: Vec<&str> = it.marks.iter().map(|m| m.kind).collect();
        assert_eq!(kinds, ["code", "strong", "link"]);
        let at = it.text.find("offical").unwrap();
        let fixed = it
            .apply_to_markdown(md, &[(at, at + 7, "official".into())])
            .unwrap();
        assert_eq!(fixed, md.replace("offical", "official"));
        // Inside code, or half in and half out of bold, is damage.
        let code = it.text.find("instal").unwrap();
        assert_eq!(it.damaging(&[(code, code + 6)]).len(), 1);
        assert_eq!(it.damaging(&[(at - 4, at + 3)]).len(), 1);
        assert!(it.damaging(&[(at, at + 7)]).is_empty());
        let zh = inline_text("我们**非常**高兴的宣布");
        assert_eq!(zh.text, "我们非常高兴的宣布");
        let de = zh.text.chars().position(|c| c == '的').unwrap();
        assert_eq!(
            zh.apply_to_markdown("我们**非常**高兴的宣布", &[(de, de + 1, "地".into())])
                .unwrap(),
            "我们**非常**高兴地宣布"
        );
    }

    #[test]
    fn completion_join_problems_are_caught() {
        assert_eq!(doubled_at_join("常备", "常备药").as_deref(), Some("常备"));
        assert_eq!(
            doubled_at_join(
                "Lessons from",
                " Lessons from
more"
            )
            .as_deref(),
            Some("Lessons from")
        );
        assert_eq!(
            doubled_at_join("Lecciones de", " Lecciones de un año").as_deref(),
            Some("Lecciones de")
        );
        assert_eq!(doubled_at_join("in the", " the end"), None);
        assert_eq!(doubled_at_join("崩溃", "率"), None);
        assert_eq!(doubled_at_join("the docu", "ment is"), None);
        assert_eq!(
            meta_commentary("约</reasoning_effort>"),
            Some("</reasoning")
        );
        assert!(meta_commentary(
            "率

Wait—the instructions say"
        )
        .is_some());
        assert_eq!(
            meta_commentary(" every box seems heavier than the last."),
            None
        );
    }

    #[test]
    fn sentences_split_in_both_scripts() {
        assert_eq!(
            sentences("He left. \"Why?\" she asked. It was 3.5 km away!"),
            ["He left.", "\"Why?\"", "she asked.", "It was 3.5 km away!"]
        );
        assert_eq!(
            sentences("她说：“走吧。”我们就走了。天黑了！"),
            ["她说：“走吧。”", "我们就走了。", "天黑了！"]
        );
        assert_eq!(sentence_lengths("我们就走了。天黑了！"), [5, 3]);
    }

    #[test]
    fn detects_every_matrix_language() {
        let samples = [
            (Lang::En, "The interviews took two months and covered forty-six residents in three blocks."),
            (Lang::ZhHans, "这项研究在三个街区进行，我们花了两个月的时间和居民进行访谈。"),
            (Lang::ZhHant, "這項研究在三個街區進行，我們花了兩個月的時間和居民進行訪談。"),
            (Lang::Ja, "この研究では三つの地区で二か月かけて住民に聞き取りを行いました。"),
            (Lang::Ko, "이 연구는 세 개의 구역에서 두 달 동안 주민들과 인터뷰를 진행했습니다."),
            (Lang::Es, "El estudio se hizo en tres barrios y los vecinos están preocupados por el alquiler."),
            (Lang::Fr, "Les entretiens ont duré deux mois et nous avons rencontré des habitants dans trois quartiers."),
            (Lang::De, "Die Interviews dauerten zwei Monate und wir haben mit den Bewohnern gesprochen."),
            (Lang::Ru, "Интервью длились два месяца, и мы поговорили с жителями трёх кварталов."),
            (Lang::Pt, "As entrevistas duraram dois meses e não foi fácil falar com os moradores da região."),
        ];
        // A completion that once read as Spanish: no accents, shared words.
        let samples = samples.into_iter().chain([(
            Lang::Pt,
            "passam por ali antes de voltar para casa e levam livros emprestados para ler no trem.",
        )]);
        // Two short completions the first round-2 run misread (as pt, en).
        let samples = samples.chain([
            (
                Lang::Es,
                " que salen tarde la usan como lugar para estudiar antes de volver a casa.",
            ),
            (
                Lang::Pt,
                " usam o espaço para estudar antes de pegar o trem para casa.",
            ),
        ]);
        for (lang, text) in samples {
            assert_eq!(detect(text), Some(lang), "{text}");
        }
        // Chinese prose with English product terms is still Chinese.
        assert_eq!(
            detect("我们用 React 和 Tauri 重写了 editor，启动时间从 3 秒降到了 800ms。"),
            Some(Lang::ZhHans)
        );
        assert_eq!(detect("42"), None);
        // Code and URLs don't count towards the language.
        assert_eq!(
            detect("修改 `fn main() { println!(\"hello world\") }` 里的输出，见 https://example.com/docs/guide"),
            Some(Lang::ZhHans)
        );
    }

    #[test]
    fn skeleton_sees_gfm_structure_and_ignores_words() {
        let doc = "---\ntitle: x\n---\n\n# T\n\n- [ ] a\n  - b\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n> [!NOTE]\n> hi\n\n```rust\nfn x() {}\n```\n\n$$\nx^2\n$$\n\nSee [docs](https://a.b) and $y$.[^1]\n\n[^1]: note\n";
        let sk = skeleton(doc);
        for token in [
            "frontmatter",
            "h1",
            "task",
            "table[2]",
            "alert:Note",
            "code:rust",
            "$$",
            "fndef:1",
        ] {
            assert!(
                sk.blocks.iter().any(|b| b == token),
                "{token} in {:?}",
                sk.blocks
            );
        }
        assert_eq!(sk.inline.get("link:https://a.b"), Some(&1));
        assert_eq!(sk.inline.get("math"), Some(&1));
        let reworded = doc
            .replace("note\n", "a different note\n")
            .replace("hi", "hello there");
        assert_eq!(skeleton(&reworded).blocks, sk.blocks);
    }

    #[test]
    fn structure_delta_accepts_exactly_the_expected_change() {
        let before = skeleton("| a | b |\n| - | - |\n| 1 | 2 |\n");
        let after = skeleton("| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n");
        let row = StructureExpect::Delta(&[("tr", 1), ("td", 2), ("/", 3)]);
        assert!(check_structure(&before, &after, row).is_ok());
        assert!(check_structure(&before, &after, StructureExpect::Same).is_err());
        let wider = skeleton("| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n");
        assert!(check_structure(&before, &wider, row).is_err());
    }

    #[test]
    fn applies_edits_the_way_the_frontend_composes_them() {
        let doc = "# Notes\n\nThe study ran in three blocks.\n\nResidents worried about rent.\n";
        let p = |action: &str, anchor: &str, text: &str| Proposal {
            action: action.into(),
            anchor: anchor.into(),
            text: text.into(),
            context: String::new(),
        };
        // A phrase mid-sentence: the insertion joins the sentence.
        let out = apply_all(
            doc,
            &[p("insert_after", "The study", "(2024)")],
            Caret::default(),
        )
        .unwrap();
        assert!(out.contains("The study (2024) ran"), "{out}");
        // A whole paragraph: a new block.
        let out = apply_all(
            doc,
            &[p(
                "insert_after",
                "Residents worried about rent.",
                "More text.",
            )],
            Caret::default(),
        )
        .unwrap();
        assert!(out.ends_with("rent.\n\nMore text.\n"), "{out:?}");
        // Typographic quotes in the anchor still resolve.
        let curly = "He said “hi” twice.";
        assert_eq!(
            locate(curly, "He said \"hi\" twice.", ""),
            Some((0, curly.len()))
        );
        // Two edits apply independently; overlapping ones are refused.
        let out = apply_all(
            doc,
            &[
                p("replace", "three blocks", "3 blocks"),
                p("delete", "Residents worried about rent.", ""),
            ],
            Caret::default(),
        )
        .unwrap();
        assert!(out.contains("3 blocks") && !out.contains("Residents"));
        assert!(apply_all(
            doc,
            &[
                p("replace", "The study", "A"),
                p("replace", "study ran", "B")
            ],
            Caret::default()
        )
        .is_err());
        // insert_at_cursor joins the sentence at the cursor.
        let at = doc.find(" ran").unwrap();
        let caret = Caret {
            cursor: Some(at),
            selection: None,
        };
        let out = apply_all(doc, &[p("insert_at_cursor", "", "(2024)")], caret).unwrap();
        assert!(out.contains("The study (2024) ran"), "{out}");
    }

    #[test]
    fn rows_items_and_sentences_join_their_block() {
        let p = |action: &str, anchor: &str, text: &str| Proposal {
            action: action.into(),
            anchor: anchor.into(),
            text: text.into(),
            context: String::new(),
        };
        let doc = "Intro.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- Transport\n  - WebSocket\n\nA one. B two.\n";
        let out = apply_all(
            doc,
            &[p("insert_after", "| 1 | 2 |", "| 3 | 4 |")],
            Caret::default(),
        )
        .unwrap();
        assert!(out.contains("| 1 | 2 |\n| 3 | 4 |\n"), "{out}");
        let out = apply_all(
            doc,
            &[p("insert_after", "  - WebSocket", "  - Long polling")],
            Caret::default(),
        )
        .unwrap();
        assert!(out.contains("  - WebSocket\n  - Long polling\n"), "{out}");
        // A sentence at a table's or list's edge is a block of its own.
        let out = apply_all(
            doc,
            &[p("insert_after", "| 1 | 2 |", "Rough figures.")],
            Caret::default(),
        )
        .unwrap();
        assert!(out.contains("| 1 | 2 |\n\nRough figures."), "{out}");
        let out = apply_all(
            doc,
            &[p("insert_after", "  - WebSocket", "That is all.")],
            Caret::default(),
        )
        .unwrap();
        assert!(out.contains("  - WebSocket\n\nThat is all."), "{out}");
        let out = apply_all(
            doc,
            &[p("insert_after", "B two.", " C three.")],
            Caret::default(),
        )
        .unwrap();
        assert!(out.ends_with("A one. B two. C three.\n"), "{out:?}");
        let out = apply_all(
            doc,
            &[p("insert_after", "A one. B two.", "New para.")],
            Caret::default(),
        )
        .unwrap();
        assert!(out.ends_with("B two.\n\nNew para.\n"), "{out:?}");
    }

    #[test]
    fn region_check_flags_changes_outside_the_target() {
        let doc = "A one.\n\nB two.\n\nC three.\n";
        assert!(check_region(doc, &doc.replace("two", "2"), "B two.").is_ok());
        assert!(check_region(doc, &doc.replace("three", "3"), "B two.").is_err());
        // A line added right after the region (a new last table row).
        let table = "| a |\n| 1 |\n\nAfter.\n";
        let added = table.replace("| 1 |\n", "| 1 |\n| 2 |\n");
        assert!(check_region(table, &added, "| a |\n| 1 |").is_ok());
        let (s, e, e2) = changed_span("中文测试", "中文考试");
        assert_eq!((s, e, e2), (6, 9, 9));
    }

    #[test]
    fn word_count_counts_cjk_by_character() {
        assert_eq!(word_count("hello world"), 2);
        assert_eq!(word_count("你好世界"), 4);
        assert_eq!(word_count("用 React 写"), 3);
    }
}
