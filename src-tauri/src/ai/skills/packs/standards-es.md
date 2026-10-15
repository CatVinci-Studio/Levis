---
name: standards-es
description: >-
  Writing conventions for Spanish: punctuation and quotation marks, numbers and dates, accents and spelling, dialogue with the raya, inclusive language and letters.
license: MIT
metadata:
  levis-version: "1"
  levis-invocation: "hidden"
  levis-sources: "Our own text. Summarised from the RAE/ASALE Diccionario panhispánico de dudas, Ortografía 2010 and related notes (summarised only, never quoted); adapted from the EU Interinstitutional Style Guide (© European Union, reproduction authorised); Unicode CLDR (facts)."
---

## typography
- Questions and exclamations need the opening ¿/¡ where the question or exclamation starts, which can be mid-sentence (…, ¿no?); headings and titles are skipped by the check. (M flag) [ES-M01; RAE-DPD *interrogación*]
- No period after a closing ?/! that ends the sentence; but after a closing quote, bracket or raya the period is required («¿Dónde vas?».), and ?… is valid. (M) [ES-M02]
- Quotes: [es-ES] « » first, then “ ”, then ‘ ’; [es-419] “ ” first is common (setting). Quotes attach to the quoted text. (M) [ES-M03]
- . , ; : always after the closing quote; the quote keeps its own ? ! … inside; a quotation that ends the sentence still takes a period after the closing mark. [es/eu] same rule (EU guide). (M) [ES-M04; EU-ISG]
- Ellipsis: three dots attached to the previous word; no extra period except after an abbreviation (admón.…); never with etc. (M) [ES-M16]
- No space before , . ; : ) » ? !; one after. (M) [ES-M18]
- Accents and diaeresis stay on capitals (ÁLVARO, ANTIGÜEDAD); only all-caps acronyms drop them (CIA). (M) [ES-M11]
- Unadapted loanwords and metalinguistic mentions in italics; whole works in italics, parts in quotes; only the first word of a work's title capitalised (newspapers and laws excepted). (S) [ES-S02]
- After a colon, lower case, except after a letter's salutation, before a quotation and similar cases. (S) [ES-S03]

## numbers
- Group digits in threes with a thin no-break space if at all; 2458 and 2 458 are both correct; never . or , as the group separator. [es-419] CLDR uses , for grouping; flag as info only. (M) [ES-M06]
- Decimal comma or point by country, never an apostrophe. (M) [ES-M07]
- Never group or punctuate identifying numbers: years, pages, verses, street numbers, postcodes, legal article numbers. (guard) [ES-M08]
- Ordinals 1.º, 2.ª, 3.er; Roman numerals take no raised letters. Centuries in Roman numerals after the noun (siglo XXI). (M) [ES-M09, ES-M15]
- % after a no-break space (10 %), with digits only, never split from the number; ranges 20-25 %. (M) [ES-M10]
- Dates day, month, year with de (20 de mayo de 2024); numeric 20.5.2024 or 20/5/2024 without zero padding; no US order; ISO only in international technical text. [es/eu] 14.3.2011, times 14.30. (M flag) [ES-M17; EU-ISG]
- A number written as a word takes no unit symbol (✗ veinte km). In general text, words for one-word numbers (0–29, tens, hundreds) and round numbers; digits in technical text; no mixing in one series. (M/S) [ES-M20, ES-S01]
- Percentages normally take an article (el 10 %). (S) [ES-S04]

## words
- Monosyllables take no tilde except diacritic pairs (tú, él, mí, sí, té, dé, sé, más): guion, fue, dio, vio, truhan (✗ guión, fué, dió, vió, truhán). (M) [ES-M13]
- solo and the demonstratives without a tilde; the tilde is acceptable only where the writer judges there's real ambiguity; esto, eso, aquello never take one (checker off by default, `es.soloAccent`). (M setting) [ES-M14; RAE-solo 2023]
- Days, months and seasons lower case unless part of a name (Viernes Santo). (M flag) [ES-M12]
- ex- attached to a one-word base (exmarido, expresidente), separate before a multi-word base (ex primer ministro), hyphenated before a capitalised name or acronym (ex-SS). (M) [ES-M19]
- For the model: dequeísmo, impersonal haber, leísmo, gerundio de posterioridad, "a nivel de", infinitive as an imperative. (S) [ES-S06, unverified]

## dialogue
- The raya (—, U+2014; ― U+2015 accepted) opens each turn with no space after it; never a hyphen or en dash. (M) [genre es; RAE-DPD *raya* 1, 3.1]
- Narrator incisos sit between rayas, a space before the opening one and none after; no closing raya if the character stops speaking; when speech continues, the interrupted utterance's punctuation follows the closing raya: —Está bien —dijo Carlos—; lo haré. (M) [*raya* 2.3a–b, f]
- After a verb of saying the comment starts lower case, even after ? or ! (—¡Qué le vamos a hacer! —exclamó); without such a verb, after a complete utterance, the speech ends with a period and the comment starts with a capital (—No se moleste. —Cerró la puerta). (M) [*raya* 2.3c–e]
- Characters' thoughts go in quotes; in a quotation or turn over several paragraphs, each later paragraph opens with ». (M) [RAE-DPD *comillas* 2b–c]

## register
- Inclusive language: the RAE treats the generic masculine as unmarked and doublets as unnecessary unless relevant, and calls @, e, x "ajeno a la morfología"; offer collective and epicene nouns first, then doublets; e only on explicit opt-in. (S) [ES-S05; RAE-inclusivo 2020]

## letters
- Letters: colon after the salutation (Estimado señor:), then a capital on the next line; a comma there is an anglicism. (M) [RAE-DPD *dos puntos* 2.9]
