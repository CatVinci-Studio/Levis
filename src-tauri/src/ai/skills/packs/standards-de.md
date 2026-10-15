---
name: standards-de
description: >-
  Writing conventions for German: quotation marks by country, dashes and ellipses, numbers and dates, spelling (2024 Regelwerk), commas, direct speech and letters.
license: MIT
metadata:
  levis-version: "1"
  levis-invocation: "hidden"
  levis-sources: "Our own text. Adapted from the Amtliches Regelwerk der deutschen Rechtschreibung 2024 (Rat für deutsche Rechtschreibung, CC BY 4.0) and the EU Interinstitutional Style Guide (© European Union, reproduction authorised); summarised from DIN 5008, the Swiss Bundeskanzlei Schreibweisungen and Weisung Genderstern (summarised only)."
---

## typography
- [de-DE, de-AT] „…“ with ‚…‘ nested (»…« common in books, a setting); [de-CH] «…» with ‹…›, no inner spaces; » « is not allowed in Swiss official texts. (M) [DE-M01; Regelwerk §79 E2 (nesting); BK-Schreibweisungen]
- Gedankenstrich is a spaced en dash –, not a hyphen. (M) [DE-M08; Regelwerk §77]
- "bis" and route dashes by setting: spaced (DIN 5008: 10 – 12 €, Basel – München), unspaced (Duden-style: 10–12), or [de/eu] a hyphen between numbers and an unspaced en dash for routes; only inconsistency flagged. (M setting) [DE-M08b]
- Ellipsis: a space before … when whole words are missing, attached for a partial word (Du D…!); no final period; ? and ! kept; cuts in quotations marked [...]. (M) [DE-M09; Regelwerk §78]
- Multi-word abbreviations take a (narrow) space: z. B., d. h., u. a., i. A.; usw. and usf. are single units. (M) [DE-M10]
- After a colon, a capital only when a sentence, direct speech or a quotation follows; words and lists stay lower case (2024). (M flag) [DE-M07; Regelwerk §75 E3]

## numbers
- Decimal comma; numbers of more than four digits grouped with a space (5423, 15 976); money may use points (51.397,30 €). [de-CH] fixed space, four digits unsplit except in tables with longer numbers; no apostrophe, point or comma; money with a decimal point (Fr. 23.50); exact amounts put the currency first (Fr. 327.65, € 64.15), rounded amounts in words after the number (20 Franken). (M) [DE-M11; DIN5008; BK-Schreibweisungen]
- % after a number takes a no-break space (5 %); derivatives and compounds are all valid and never flagged: 100%ig, 100-prozentig, 25%ige, 5-%-Klausel, 5-Prozent-Klausel, Fünfprozentklausel, 5%-Klausel, 0,5‰-Grenze. (M spacing only; guard) [DE-M12; Regelwerk §36(3), §41; EU-ISG]
- [de-DE/din5008] numeric dates zero-padded (03.10.2022, 2022-10-03); alphanumeric dates not (3. Oktober 2022); ordinals take a period (1. Platz). (M flag) [DE-M13]

## words
- ß after a long vowel or diphthong; [de-CH] ss may always be used (never "corrected"); ss when ß is unavailable; capitals ẞ or SS. (M) [DE-M14; Regelwerk §25]
- Variants removed in 2024 are errors (Jogurt, Spagetti, Tunfisch and about 20 others); Couvert, Façon and Portrait are now allowed. (M) [DE-M15; Regelwerk-Änderungen]
- English verbs take German endings (gechillt); gelikt or geliked, relaxt or relaxed in participles; inflected forms only with -t (das gelikte Foto). (M flag) [DE-M16]
- Apostrophe for the genitive of names ending in s, ss, ß, x, z, ce (Max’ Tante); Eva’s Blumenladen only as a whole business name; always Evas Mutter. (M flag) [DE-M17]
- Polite Sie and Ihr capitalised; du, dein, ihr, euer lower case (capitals optional in letters). (M flag) [DE-M18; Regelwerk §§65–66]
- Gender characters inside words (*, :, _, Binnen-I) are not core orthography and not spelling errors: no flag by default; flag only under a no-characters policy (Swiss federal texts 2021, which also reject the generic masculine; Bavaria 2024; Hessen 2024; school rules in Saxony, Saxony-Anhalt, Schleswig-Holstein). The /-innen form is covered by the Regelwerk. (M setting `de.genderChars`) [DE-M20; RfdR-Sonderzeichen; BK-Genderstern]

## dialogue
- A colon when the reporting clause comes first; when it follows, a comma after the closing quote and the quote loses its period („Ich komme“, sagte sie.); ? and ! stay inside and the comma still follows („Kommst du?“, fragte er.); an inserted clause takes commas on both sides; both parts may keep their own ? or ! (Fragtest du: „Wann beginnt der Film?“?). (M) [DE-M02; Regelwerk §79 E1]

## register
- Subordinate clauses take commas, inserted ones on both sides (code flags a missing comma before dass, weil, obwohl, ob, damit or a relative pronoun not at sentence start). (M flag) [DE-M03; Regelwerk §73]
- Extended zu-infinitive groups take a comma (2024); a bare zu-infinitive may go either way; after versuchen, erlauben, beabsichtigen, versprechen, gestatten, probieren, wagen both forms are correct and never flagged. (S) [DE-M04; Regelwerk §73 E4]
- No comma between parts joined by und, oder, sowie, wie, bzw., sowohl … als, weder … noch, entweder … oder; always a comma before aber, doch, jedoch, sondern joining parts; never auto-remove a comma before und (it may close an insertion). (S; code only for aber/sondern) [DE-M05; Regelwerk §§70–72]
- Inserted place, address or date additions take a closing comma (Am Freitag, den 25. September, feiern sie…) (2024). (M flag) [DE-M06]
- Where a comma's position changes the meaning, keep the author's or ask. Plain German: avoid noun chains and long verb brackets; Leichte Sprache follows DIN SPEC 33429 and needs reader testing. (S) [DE-S01, DE-S02]

## letters
- "Sehr geehrte Frau Schröder," then the next line starts lower case; [de-CH] no mark after the salutation, then a capital; rarely "Lieber Klaus!" with a capital after; "Mit freundlichen Grüßen" without punctuation. (M) [DE-M19; Regelwerk §53 E2, §72]
