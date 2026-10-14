---
name: proofread
description: >-
  Proofreads text against the standards of its language and the project's
  conventions: spelling, wrong characters and words, grammar, punctuation,
  numbers and typography; fixes clear errors and comments on judgement calls,
  without rewriting the style. Use when asked to proofread, check for typos or
  errors, or check against a standard (校对/查错, 校正, 교정·맞춤법 검사, corregir,
  relire, Korrektur lesen, вычитать).
license: MIT
metadata:
  levis-version: "1"
  levis-invocation: "both"
  levis-category: "check"
  levis-packs: "contract standards#typography standards#numbers standards#words"
  levis-sources: "Our own text. Standards summarised per the attached language packs; error-rate figures from 图书质量管理规定 (2004), 报纸期刊质量管理规定 (2020) and CY/T 266-2023 (summarised)."
  levis-aliases-en: "typos, check"
  levis-aliases-zh: "校对, 查错, 挑错, 校稿"
  levis-aliases-zh-Hant: "校對, 校稿, 挑錯"
  levis-aliases-ja: "校正, 誤字チェック"
  levis-aliases-ko: "교정, 맞춤법, 맞춤법 검사"
  levis-aliases-es: "corregir, revisar"
  levis-aliases-fr: "relire, coquilles"
  levis-aliases-de: "korrektur"
  levis-aliases-ru: "вычитать, корректура"
  levis-aliases-pt: "revisar, revisão"
---

# Proofread

## Scope
- The selection; else the passage or section the user names; else the whole document.
- Proofreading is not polishing: fix errors, never rewrite for style.

## Steps
1. If a check_conventions tool is available, run it on the scope first and use its findings (rule, span, suggested fix).
2. Read the text for what mechanical checks can't see: wrong characters and words in context (的/地/得, 截至/截止, homophones), agreement, case, tense, particles, missing or doubled words, wrong idioms, inconsistent terms and names, possible factual slips.
3. Check punctuation, numbers and typography against the attached conventions for the document's language and profile.

## Do
- Fix what is unambiguously wrong. Where the attached conventions allow more than one form, keep the document's majority form and fix only the inconsistent ones.
- Leave valid variants alone. Examples that are correct: Spanish ?». and ?…; Russian ?.. and «В бой!».; a Korean comma after a connective ending, and 3 개 spacing; German % compounds and the optional infinitive comma after versuchen; French spellings old or rectified (1990); Portuguese double spellings and optional accents; English serial comma either way, split infinitives, "data is"; Chinese four-digit numbers without separators.

## Don't
- Rewrite for style, reorder sentences or "improve" wording that is correct.
- Change names, quotations, code, URLs or citations, except for a plain typo the user asked you to fix.

## Caps
- At most 12 proposals and 20 comments per turn. Summarise the rest by type in the reply and offer to continue.

## Optional error-rate report (Simplified Chinese, only on request)
- When asked to count the error rate or to check against the publishing quality standard: weight the errors (books by CY/T 266; newspapers and periodicals by the 2020 annex), give the rate per 10,000 characters and the pass marks (books ≤ 1 per 10,000; periodicals ≤ 2; newspapers ≤ 3; a book at 5 or more must be recalled). Label it an estimate, not an official assessment.

## Deliver
- Edit mode: replace proposals for unambiguous fixes, grouped one per paragraph, each reason naming the rule ("全角标点", "1990s, not 1990's"). Comments for judgement calls: style, register, possible fact errors, unclear references.
- Ask mode, or "only check": comments only.
- Reply in one or two sentences: how many fixes by kind, and what is left as comments.
