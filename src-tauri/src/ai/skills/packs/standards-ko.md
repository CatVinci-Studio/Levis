---
name: standards-ko
description: >-
  Writing conventions for Korean: spacing and punctuation (한글 맞춤법, 문장 부호), spelling and loanwords, dialogue, register and workplace honorifics, letters, 공문서, ad disclosure and AI tells.
license: MIT
metadata:
  levis-version: "1"
  levis-invocation: "hidden"
  levis-sources: "Our own text. Quoted or summarised from 한글 맞춤법 (문장 부호 included), 외래어 표기법, 국어기본법 제14조 and 행정업무의 운영 및 혁신에 관한 규정 시행규칙 (unprotected official texts); 국립국어원 해설 and 표준 언어 예절 (summarised); 공정위 2024 guideline (summarised); k-skill and im-not-ai (MIT, ideas)."
---

## typography
- Particles attach to the previous word, including Latin text and digits (API를, 3개를); never insert a space there. (M) [KO-M-01; 맞춤법 제41항]
- Dependent nouns spaced (할 수 있다, 먹을 만큼, 떠난 지, 아는 대로, 사흘 만에); the same strings attach as particles or endings (셋뿐, 법대로, 하나만, 어디 있는지). (S) [KO-M-02; 제42항]
- Unit nouns spaced (차 한 대); joining allowed for order, dates, times and after Arabic numerals (2 시간 / 2시간); only inconsistency flagged. (M) [KO-M-03; 제43항]
- Numbers spaced by 만 (12억 3456만 7898); 겸, 내지, 대, 및, 등, 등등, 등속, 등지, 따위 spaced (대- attaches as a prefix: 대국민). (M) [KO-M-04, KO-M-05]
- One-syllable words joined two at a time only where meaning groups them (좀더 큰). (S) [KO-M-06]
- Auxiliary verbs spaced in principle; joining allowed after -아/-어 and before 듯하다/만하다/법하다/성싶다/척하다; never when a particle intervenes (읽어는 보았다) or after a 종결 어미 (먹나 보다). (S) [KO-M-07; 제47항]
- 채영신 씨, 김 과장, 홍길동 님 (spaced); 부장님 (attached). (M) [KO-M-08; 제48항]
- Proper nouns and technical terms word by word in principle, joining allowed; geographic names one word (북한산, 카리브해); single-kanji Japanese or Chinese names double the generic noun (온타케산, 주장강). (M/S) [KO-M-09, KO-M-10]
- Period at the end of statements; dates `2026. 10. 14.` with the final period; never `2014.` for a year alone. (M) [KO-M-17, KO-M-18]
- 쌍점 attached before, a space after (장소: 광화문); none in times and ratios (10:20, 65:60); 빗금 closed up; 줄표 spaced in principle; 물결표 closed up (9월 15일~9월 25일). (M) [KO-M-19–KO-M-22]
- 줄임표 …… is the rule; ......, … and ... are allowed (never flag ...); attached to the previous word; after unfinished speech add . ? or !. (M) [KO-M-23]
- “ ” for dialogue and direct quotation, ‘ ’ for inner quotes, thoughts and emphasis; titles 『』/《》 (or “ ”), parts 「」/〈〉 (or ‘ ’), consistently. (M) [KO-M-24, KO-M-25]
- 가운뎃점 for groups and shared parts (금·은·동메달); U+00B7, U+318D, U+30FB and U+2027 normalised per document. (M) [KO-M-26]
- No 。 or 、 in Korean (removed in 2015). (M) [KO-M-44]
- A comma after a connective ending (-고, -며, -지만, -아서) is correct and never removed; (?) after an uncertain item and thousands commas (100,000원) are legitimate. (guard) [문장 부호 쉼표 (5); KO-M-27, KO-M-28]

## words
- 렬/률 → 열/율 after a vowel or ㄴ (비율, 실패율; 합격률). (M) [KO-M-11]
- 사이시옷 only in 곳간, 셋방, 숫자, 찻간, 툇간, 횟수; 해님, 개수. (M) [KO-M-12]
- 며칠, never 몇일; 돼/됐다 (안 돼요, not 안되요); 깨끗이, 솔직히; 로서/로써 and 든지/던지 checked in context. (M) [KO-M-13–KO-M-16]
- Double passive as a soft hint: 보여지다 → 보이다, 잊혀지다 → 잊히다. (M hint) [KO-M-43]
- Loanwords: finals only ㄱㄴㄹㅁㅂㅅㅇ (로봇, 커피숍); no tense consonants for plosives (파리, 카페); established spellings (콘텐츠, 메시지, 리더십), each list entry checked against 외래어 표기 용례 before shipping. (M) [KO-M-29, KO-M-30]
- Japanese names: word-initial カ/タ rows → 가/다, medial → 카/타; ツ → 쓰; ッ → final ㅅ (삿포로); long vowels not written (도쿄, 규슈). Chinese names: no tones; ㅈ/ㅉ/ㅊ + ㅏㅔㅗㅜ. (M) [KO-M-31, KO-M-32]

## dialogue
- `“…”라고` attached; `“…” 하고` and `‘…’ 하고 생각했다` spaced; plays written entirely as dialogue take no quotes; a period inside a direct quote is the default and may be omitted (`ko.quotePeriod`), consistently. (M) [genre ko; 문장 부호 마침표 붙임 1]

## register
- No mixing of 하십시오체 and 해요체 (or 해라체) in a formal text; internal reports may use 개조식 -함/-임. (M) [KO-M-41]
- 사물 높임 is wrong (커피 나오셨습니다). (M hint) [KO-M-42]
- At work: title + 님 for superiors, name + 님/씨 for peers; no 압존법 (총무과장님이 …하셨습니다). Soft: 수고하십시오 to superiors, 좋은 아침, 들어가세요. (S) [KO-S-03, KO-S-04]
- Concise, plain terms; no ungeneralised abbreviations or jargon in official text. (S) [KO-S-01]

## letters
- 두괄식 with exact deadlines and amounts; consistent 하십시오체; own title before own name (사장 홍길동 올림); never 「홍길동 교수입니다」; no doubled honorifics (선생님 귀하); 씀/드림 fine, no period after 드림/올림; no To/From or ~로부터. (S/M) [KO-S-05, KO-S-06]

## official
- Hangul per 어문규범, hanja or foreign words in parentheses; Arabic numerals; plain terms (국어기본법 제14조); dates `2026. 10. 14.`, times `14:30`; amounts `금113,560원(금일십일만삼천오백육십원)`; item symbols 1. → 가. → 1) → 가) → (1) → (가) → ① → ㉮, each level 2타 further in, 1타 after the symbol, no symbol for a single item; 붙임 line; `끝.` two half-width spaces after the last character; `이하 빈칸` when a table ends early; first-level indent per `ko.firstItemIndent`. (M) [KO-M-33–KO-M-40]

## social
- Sponsored or affiliate posts (from 2024-12-01): disclosure in the title or first part of text posts; conditional commissions disclosed; "수수료를 지급받을 수 있음" counts as unclear; `[광고]` in video titles; `광고입니다` first on Instagram; 체험단 or a bare #brand isn't enough. (M flag) [공정위 2024 guideline, summarised]

## ai-tells
- S1 (one sighting): ~에 대해(서), ~를 통해, ~에 있어(서); 되어지다; 그/그녀/그것 three or more times in a paragraph. S2: ~와 관련하여; an English term in parentheses after its first mention. Warn above 30% change, stop above 50%. A comma after a connective ending is never a tell. Proper nouns, numbers, quotations, legal text and standard abbreviations are excluded. [k-skill korean-humanizer and im-not-ai (MIT)]
