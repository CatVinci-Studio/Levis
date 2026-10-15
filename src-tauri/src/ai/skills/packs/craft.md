---
name: craft
description: >-
  Language-independent writing craft that built-in skills attach: fiction (show and tell, point of view, poems, screenplays), plain language, email structure, and social platform limits.
license: MIT
metadata:
  levis-version: "1"
  levis-invocation: "hidden"
  levis-sources: "Our own text. Summarised from Wikipedia (Show, don't tell; Narration; Screenplay; Haiku; Jueju; Regulated verse; Sijo), CommonMark, Fountain, the Federal Plain Language Guidelines and The Tongue and Quill (public domain), GOV.UK (OGL v3.0), 公用文作成の考え方 (文化庁), 국어기본법, Lei 15.263/2025, DIN SPEC 33429; platform limits are dated facts from the platforms' documentation."
---

## fiction
- Show the moments that matter through action, dialogue and sensory detail; tell for summary, transitions and passing time. (S) [Show, don't tell (Wikipedia, summarised)]
- One point of view per scene; switch only at a section or chapter break; a limited narrator can't report what the character can't know. (S) [convention; Narration (Wikipedia) for the terms]
- Keep the scene's tense; flag likely accidental tense switches as hints, never errors; the historical present and deliberate shifts are valid (en, es, fr, de, ru, pt). (S) [convention]
- Names, spellings and attributes of characters, places and terms match the library. (M, library check) [product rule; FI-03]
- Poems: never join lines, capitalise line starts or "fix" fragments; a line break inside a poem is a hard break in Markdown. Form hints, not errors: haiku 5-7-5 on (morae), tanka 5-7-5-7-7, jueju 4 lines of 5 or 7 characters with rhyme on lines 2 and 4, lüshi 8 lines, sonnet 14 lines, sijo 3 lines of about 14–16 syllables. (M/S) [CommonMark §6.7–6.8 (summarised); Wikipedia: Haiku, Jueju, Regulated verse, Sijo]
- Screenplays (if asked): Fountain-compatible scene headings (INT./EXT. + place + time), character cues in capitals, parentheticals, transitions ending in TO:; spec scripts have no scene numbers, little bold, no ALL-CAPS dialogue; one page ≈ one minute is rough and contested. (M/S) [Fountain syntax; Academy Nicholl; Screenplay (Wikipedia)]

## plain
- Main point first; address the reader as "you"; everyday words; active voice; present tense; replace hidden verbs; must (requirement) / need (step) / can (option). (S) [PL-01, PL-03, WC-01, WC-06, WC-07, VT-01; FPLG; GOV.UK; digital.gov]
- Sentences average 15–20 words; split those over 25; paragraphs of about 3–5 sentences, rarely over 150 words. (M as hints) [SP-01, SP-02; GOV.UK; 1998 federal guidance; Tongue and Quill]
- Headings that outline the content, at most three levels; lists for three or more parallel items; tables for if/then conditions. (S) [PL-05, PL-06; FPLG]
- In other languages apply the same principles with the local norms: 公用文作成の考え方 (結論を先に, 50–60 字), やさしい日本語 for non-native readers, 국어기본법 제14조 (terms the public easily understands), Lei 15.263 art. 5º (pt-BR), lenguaje claro / langage clair (ISO 24495-1 principle names only), Leichte Sprache drafts marked as needing reader testing (DIN SPEC 33429). (S) [JA-S-02, JA-S-10, KO-S-01, PT-S02, DE-S02]

## email
- Subject specific, about 5–8 words; the bottom line in the first one or two sentences; then impact, next steps, details (BLIND); the ask, the owner and the deadline explicit; short paragraphs; at most about 24 lines. (S/M) [EM-01, EM-02; Tongue and Quill; AR 25-50]
- To for action, Cc for information; mention of an attachment → remind to attach it; meetings with date, weekday, time and time zone. (M hints) [EM-04, EM-09]
- Careful with humour and irony; no ALL CAPS; few exclamation marks; sensitive news not by email. (S) [EM-03, EM-05]

## platforms
- Limits as verified on 2026-10-14; "warn only" limits produce warnings, never refusals.
- X: 280 weighted: weight 1 for U+0000–U+10FF, U+2000–U+200D, U+2010–U+201F, U+2032–U+2037; 2 for everything else (CJK, kana, Hangul); every URL 23; each emoji 2; NFC first (verified: X docs; twitter-text v3.json, Apache-2.0)
- Bluesky: 300 graphemes and 3,000 UTF-8 bytes; up to 8 tags of ≤ 64 graphemes (verified: atproto lexicon)
- Threads: 500 characters, plus an optional 10,000-character text attachment (verified: press, Meta-confirmed)
- Instagram: caption 2,200 characters; at most 5 hashtags (since Dec 2025; the API reference still says 30) (verified)
- Mastodon: 500 by default, per server (read the instance limit); each link 23; mentions count the username only (verified: docs, GFDL: facts only)
- LinkedIn: post 3,000; the "see more" fold at about 140 (mobile) to 210 (desktop) characters (third-party)
- WeChat 公众号 (API): title ≤ 32, author ≤ 16, digest ≤ 120 (empty digest = first 54 characters), content < 20,000 characters and < 1 MB (verified (WeChat docs); the web editor's 64-character title is third-party)
- 小红书: title ≤ 20, body ≤ 1,000, about 10 tags (unverified: warn only)
- 微博: about 2,000 characters, folded at 140 (2016 reports: warn only)
- GOV.UK: page title ≤ 65 characters; summary ≤ 160 ending with a full stop (verified: OGL)
- zh academic title: ≤ 25 字 (verified: GB/T 7713.2)
