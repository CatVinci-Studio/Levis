---
name: dialogue
description: >-
  Polishes dialogue in fiction and scripts: speech punctuation and quotation marks
  by the language's conventions (“”, 「」, raya, guillemets, „“, тире), speech tags
  and action beats, one speaker per paragraph, natural speech. Use when asked to
  fix or improve dialogue or its punctuation (对话/对白, 会話文・台詞, 대사,
  diálogo, dialogues, Dialog, диалог).
license: MIT
metadata:
  levis-version: "1"
  levis-invocation: "both"
  levis-category: "write"
  levis-packs: "contract craft#fiction standards#dialogue"
  levis-sources: "Our own text. Dialogue rules summarised from GB/T 15834, the Taiwan MOE handbook, JLReq (W3C), 한글 맞춤법 문장 부호, RAE DPD, OQLF, Amtliches Regelwerk 2024 (CC BY 4.0), Правила 1956 and Ciberdúvidas."
  levis-aliases-en: "dialog"
  levis-aliases-zh: "对话润色, 对话, 对白"
  levis-aliases-zh-Hant: "對話潤飾, 對話, 對白"
  levis-aliases-ja: "会話文を整える, 会話文, 台詞"
  levis-aliases-ko: "대사, 대화문"
  levis-aliases-es: "diálogo"
  levis-aliases-fr: "dialogues"
  levis-aliases-de: "dialog"
  levis-aliases-ru: "диалог"
  levis-aliases-pt: "diálogo"
---

# Polish dialogue

## Scope
- The selection; else the dialogue the user names; else the dialogue in the current scene.
- If a check_conventions tool is available, run it on the passage first and use its dialogue findings.

## Two jobs, by request
- **Punctuation** ("fix the punctuation", "只改标点"): normalise to the project's dialogue style, or to the document's majority style when none is set. Every change is mechanical; say which rule in the proposal's reason. Change nothing but punctuation and spacing.
- **Craft** ("improve the dialogue"): tags versus action beats, adverb-heavy tags, a new paragraph for each speaker, rhythm, distinct voices. Keep each character's words unless the user asks for rewrites.
- "Check my dialogue" asks for comments, not edits.

## Do
- Apply the attached dialogue conventions for the document's language exactly: quotation marks and nesting, where the final mark goes, the comma or colon around the tag, capitals after the tag, dashes and ellipses for interruption and trailing off.
- Spanish and Portuguese: the raya or travessão opens each turn; narrator incisos between dashes per the attached rules. Russian: a turn that starts a paragraph begins with "— " and takes no quotes. French: one dash style per document.
- Keep the document's dash style (em, en, ——, ――) and its quote style when it is consistent and valid.
- One proposal per paragraph or contiguous dialogue block.

## Don't
- Change what a character says, beyond punctuation, unless asked; never add lines unless asked.
- Convert straight quotes to curly ones when the document is plain Markdown for code or the project uses straight quotes.
- "Correct" forms the conventions list as valid: Spanish ?». and ?…, Russian ?.., a Korean period dropped consistently inside quotes.

## Deliver
- Edit mode: replace proposals, each with a short reason naming the rule.
- Ask mode: comments on the lines that need changes, with the corrected line.
- Reply in one or two sentences: what kind of fixes were made, and any line left alone on purpose.
