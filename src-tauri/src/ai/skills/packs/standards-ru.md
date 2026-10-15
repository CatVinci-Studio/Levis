---
name: standards-ru
description: >-
  Writing conventions for Russian: quotation marks, dashes and spacing, numbers and units, ё and official-language rules, dialogue, commas and letters.
license: MIT
metadata:
  textus-version: "1"
  textus-invocation: "hidden"
  textus-sources: "Our own text. Quoted or summarised from Правила русской орфографии и пунктуации (1956), 52-ФЗ and распоряжение 1102-р (official texts); summarised from ГОСТ 8.417-2002 and Еськова 2012; talkstream/ru-text (MIT, ideas)."
---

## typography
- Quotes «…» outside, „…“ inside; inner and outer quotes always differ in shape, and the outer pair is never dropped («„Ленинград“ вошёл…»); straight quotes only in code, file names and URLs. (M) [RU-M01; Правила 1956 §200; ru-text R1, R4]
- . , ; : and — go after the closing quote; ? ! … inside if they belong to the quote, outside if they belong to the sentence; the same mark isn't repeated (Читали ли вы роман «Что делать?»); quoted speech ending in ?/!/… takes no extra period (Я спрашиваю: «Но как же тогда?»), but a title ending in ! inside a sentence keeps the sentence's period (…пьесу «В бой!».). (M for . and ,; flag only for ?». and !».) [RU-M02; §§199–200]
- Dash between words: an em dash with a no-break space before and a normal space after (Москва — столица); hyphens inside words unspaced (кто-то); ranges with an unspaced dash (1941–1945, XI–XIV вв.; en or em dash per `ru.rangeDash`). (M) [RU-M03; §178]
- Comma and dash together: the comma first (, —). (M) [RU-M04; §198]
- ?.. and !.. are valid. (guard) [RU-M14]
- No-break space after one-letter words (в, к, с, о, у, и, а, я) in typeset text (setting). (M setting) [ru-text R30]
- т. е., т. д., и т. п., 2026 г. with (narrow) no-break spaces. (M) [RU-M12, unverified source]

## numbers
- Decimal comma; thousands grouped with a no-break space from five digits; four-digit numbers unsplit; never , or . as the group separator. (M) [RU-M08]
- Percent: [ru/gost] 80 %; book and web tradition 80%; only inconsistency flagged. (M setting) [RU-M09; ГОСТ 8.417]
- A space between a number and a unit symbol (100 кВт, 20 °С), none before raised signs (20°); no period after unit symbols. (M) [RU-M10; ГОСТ 8.417]
- Наращение: one letter after a vowel-final ending (5-й, 5-я), two after a consonant (5-го, 5-му); none after Roman numerals or in dates (1 мая); flag 5-ый, 2-ой, 5-ого. (M) [RU-M11, unverified source]
- № and ₽ separated by a no-break space (№ 12, 1 500 ₽). (M) [ru-text R68, R86]

## words
- Ё is selective: required where it prevents misreading (всё/все, узнаём/узнаем), in little-known words and names, and in teaching texts; never flagged; never е→ё without a dictionary (`ru.yo`). (M setting) [RU-M07; Правила 1956 §10; Еськова 2012]
- [official] In "state language" uses, words must be in the normative dictionaries (52-ФЗ; list in 1102-р, amended 1406-р); avoid foreign words with common Russian equivalents; consumer-facing signs and information in Russian from 1 Mar 2026. Not for fiction or private text. (S) [RU-S02]
- Feminitives: established forms (учительница) are neutral; new -ка forms (авторка) only on request. (S) [RU-S03, unverified]

## dialogue
- A turn that starts a paragraph begins with "— " and takes no quotes; inline speech goes in «»; narrator after speech: — Привет, — сказал он. / «Привет», — сказал он.; before: Он сказал: «Привет».; interrupted: — …, — сказал он, — …; turns run on one line: «…» — «…». (M) [RU-M05; §§195–197]

## register
- Commas, high-precision subset: around common parenthetical words and vocatives; before но, а, однако, чтобы, который, потому что joining clauses; none before a single и joining homogeneous members. (M flag) [RU-M13]
- Subject–predicate dash between two nominative nouns or infinitives without a copula, and before это/вот; none with не (Бедность не порок). (S/M flag) [RU-M06]

## letters
- Letters: «Уважаемый …!»; Вы capitalised when addressing one person; titles capitalise only the first word («Война и мир»). (S) [RU-S01, unverified source]
