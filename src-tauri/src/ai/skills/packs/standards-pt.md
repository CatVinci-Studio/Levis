---
name: standards-pt
description: >-
  Writing conventions for Portuguese (Brazil by default, Portugal noted): quotation marks, numbers, ordinals and dates, capitals and hyphens under the 1990 agreement, dialogue, register, official writing and letters.
license: MIT
metadata:
  textus-version: "1"
  textus-invocation: "hidden"
  textus-sources: "Our own text. Quoted or summarised from the Acordo Ortográfico de 1990, Decreto 9.758/2019 and Lei 15.263/2025 (unprotected official texts); summarised from the Manual de Redação da Presidência da República and Ciberdúvidas (summarised only); adapted from the EU Interinstitutional Style Guide (© European Union, reproduction authorised); Unicode CLDR (facts)."
---

## typography
- Quotes: [pt-BR] “ ” with ‘ ’ nested; [pt-PT] « » with “ ” nested; no inner spaces. (M) [PT-M01; Manual-Presidência 10.1; CLDR]
- [pt-BR/official] When a quoted sentence ending in . ? or ! also ends the sentence, the mark goes inside the quotes and nothing follows; a ?/! of the whole sentence goes outside; if the sentence continues, the quote keeps ?/! but drops its period. [pt-PT, pt/eu] inside if the whole sentence is quoted, otherwise after. (M flag) [PT-M02; EU-ISG]

## numbers
- Decimal comma; [pt-BR] groups with a point; [pt-PT] with a no-break space (four digits unsplit); never group years or page numbers; % per setting (CLDR 10%, EU 10 %). (M) [PT-M03]
- Ordinals: [pt-BR] 1º, art. 1º; [pt-PT] 1.º, n.º, artigo 1.º; never the degree sign °. (M) [PT-M12]
- [pt-BR/official] dates "Brasília, 2 de fevereiro de 2018." — 1º for the first day, no leading zero, month in lower case. (M flag) [PT-M13]

## words
- Days, months, seasons and cardinal points in lower case (outubro, segunda-feira, norte); capitals for regions used absolutely (o Nordeste), festivals (Natal), institutions and periodicals. Optional capitals are never flagged (later words of book titles, school subjects, titles of address and saints, street categories). (M flag; guard) [PT-M04, PT-M05; AO90 Base XIX]
- AO90 prefix hyphens: before h (pré-história) and between equal vowels (micro-onda; co- usually joins: cooperar); with circum-/pan- + vowel, m or n; hiper-/inter-/super- + r; ex-, vice-, stressed pós-/pré-/pró-; no hyphen before r/s, which double (antirreligioso, minissaia), or before a different vowel (autoescola); check VOLP (BR) divergences such as coerdeiro. (M) [PT-M06; AO90 Base XVI]
- Locutions lose the hyphen (fim de semana, à vontade) except set forms (cor-de-rosa, água-de-colônia/colónia, mais-que-perfeito, pé-de-meia, à queima-roupa); plant and animal names keep it (couve-flor); hei de without a hyphen; enclisis and mesoclisis keep it (amá-lo, dar-lhe-ei). (M) [PT-M07, PT-M08]
- [pt.ao90=on] Pre-AO90 spellings flagged: pt-PT acção, óptimo, director; pt-BR idéia, heróico, vôo, crêem, pára (verb), pêlo, pólo, lingüiça; pôde/pode and pôr/por stay. Optional accents never flagged (amámos/amamos, dêmos/demos, fôrma/forma); double spellings belong to the variant (facto/fato, receção/recepção, António/Antônio). (M; guard) [PT-M09–PT-M11; AO90 Bases IV, IX]

## dialogue
- The travessão opens a turn; if the turn doesn't end with a line break, a second travessão closes the speech before the narrator's tag (– És parvo! – disse a Luísa.); alternatively quotation marks with the narration outside («És parvo!», disse a Luísa.). (M) [Ciberdúvidas (summarised)]

## register
- BR vs PT differences (pronoun placement, estou fazendo vs estou a fazer, forms of address, vocabulary pairs) are flagged for the user, never auto-converted. (S) [PT-S01, unverified list]

## letters
- Letters: "Prezado(a) …," (convention). (S)

## official
- [pt-BR/official] federal official mode: only *senhor/senhora*; never Vossa Excelência, Excelentíssimo, Vossa Senhoria, Vossa Magnificência, doutor, ilustre/ilustríssimo, digno/digníssimo or respeitável (with the decree's exceptions and reciprocity). (M flag) [Decreto 9.758/2019]
- [pt-BR/official] plain language per Lei 15.263/2025 art. 5º: direct word order, short sentences, one idea per paragraph, common words, jargon explained, uncommon foreign words avoided, the full name before an acronym, the most important information first, active voice, no nominalisations or redundancy, testing with the audience; no new gender or number inflections (todes, elu) (item XI). (S) [PT-S02; Lei 15.263]
