# AI evaluation

How every AI feature in Levis is evaluated against the real Anthropic API,
what the first full evaluation found, what was changed because of it, and
what is still weak. The suite lives in `src-tauri/src/ai/live_eval.rs` and
`src-tauri/src/ai/live_eval/`; this document is its guide and its record.

## What is evaluated

Each case goes through the app's real code path: the same system prompts,
tool definitions, agent loop, completion and grammar prompts, and the same
post-processing (`finish_completion`, `parse_grammar_reply`). Where the
frontend does something to the model's output, the eval mirrors it - for
example `checks::apply_all` composes an accepted `propose_edit` exactly as
`src/ai/doc-markdown.ts` does, and the completion's "what the user sees"
applies the editor's `stripEcho` and `tidySuggestion`. Requests use the
app's own sampling settings (no temperature override; Haiku's thinking is
disabled for completions as in the app).

### The matrix

| Suite        | Cases | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`      |   150 | Round 1 (75 cases): **Languages**: one report in en, zh-Hans, zh-Hant, ja, ko, es, fr, de, ru, pt and mixed Chinese/English, each asked a question and asked to tighten a paragraph; requests in a different language from the document; translation (whole paragraph, and a selection). **Markdown**: edit a table cell, add a table row, fix a bug in fenced Python and JS, check off a task (en, ja), add a nested list item, fix display math, add a footnote, shorten a GitHub alert, change a link, edit YAML front matter, raw HTML, a Mermaid diagram, rename a heading, rewrite a paragraph that carries a link, inline math and a footnote ref, change an image's alt text, answer a question about the document. **Agent behaviour**: summarise (in chat, and into the document), expand, rewrite formally, delete a sentence, continue, replace a selection, insert at the cursor (en, zh) and inside a sentence, review with comments (edit mode and ask mode), questions that must not become edits, plan mode, two ambiguous requests, three multi-turn follow-ups (accept then "same again", reject then retry, question then act), agent.md (reply language + spelling; Chinese conventions), the style profile, the library (a fact by alias; character consistency), a `/skill` and a skill matched by description, facts from a project file, one section of a 60k-character document. |
| `completion` |   106 | Round 1 (43 cases): Every tone preset (default, formal, casual, academic, concise) on English mid-sentence, English long continuation and Chinese after-sentence text; mid-sentence in every matrix language; list item (en, zh), table cell, heading (en, zh), blockquote; a Python code block with the hint the editor sends today and with the new `code block` hint; after-text (manual trigger mid-document); three candidates (en, zh); the cursor inside a word (en, fr, de); a nearly empty document.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `grammar`    |    61 | Round 1 (26 cases): Each strictness level on real mistakes and on correct text (where any report is a false positive); typos (en, zh, zh-Hant wrong script, ja, ko), grammar (en, zh 的/地, fr, de, es, ru, pt), code tokens / URLs / math / names / dialogue that must be left alone, "typos" mode on a paragraph that also has a grammar mistake, strict mode on wordy text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| model runs   |       | `agent-models`: 17 agent cases (one of each kind) on Haiku 5.5, Sonnet 5.5 and Opus 5.5. `completion-models` / `grammar-models`: both suites on Haiku 5.5 and Sonnet 5.5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Round 2 additions

Round 2 (`agent_everyday.rs`, `agent_workspace.rs`, `completion_cases.rs`,
`grammar_cases.rs`) added many more Chinese and English cases and made the
workspace and writing-style features explicit.

- **Agent, everyday writing (25 zh + 25 en)**: emails, a weekly report and
  a support review with tables, academic paragraphs with citations,
  technical docs with code (a JS bug, Python comments to translate, a
  numbered step to add, inline code to keep), meeting notes (check off a
  task, turn items into a checklist, add a deadline), essays (vivid without
  inventing, cut clichés, continue), fiction with dialogue (action beats,
  quote marks kept, insert at the cursor, continue the scene), social posts
  under a length limit, product copy into a list; casual ("can u make the
  first para shorter") and formal phrasing; a 42k-character Chinese report
  edited and quoted in the middle (outline only, must read chapter 7).
- **Quick Ask vs the panel**: both send the same `ai_agent_message`; the
  differences are that Quick Ask opens in edit mode on the selection it
  captured and sends every follow-up against that range as mapped through
  the accepted edits (`useInlineChat`'s `sendContext`, chat-selection-plugin),
  while the panel defaults to Ask mode and sends the live selection or
  cursor. Cases: a single Quick Ask edit (zh, en), a five-turn Quick Ask
  conversation on one paragraph (zh) and a five-turn panel conversation
  (en), and an edit request sent in the panel's default Ask mode (zh, en),
  where no edit tool exists.
- **Workspace**: the folder the AI may read - the open document's own
  folder by default, or the folder picked in the panel - with project files
  (`list_files`/`read_file`/`search_files`), the library
  (`.levis/library/*.md`, entries sent when their name or an alias is
  mentioned), `.levis/agent.md`, `.levis/skills/*.md`, plus the global
  config folder (`agent/` in the app config dir) whose agent.md and skills
  apply everywhere and are shadowed by the project's. Each case builds the
  folders on disk and loads them through `workspace::load_from` (the app's
  loader): facts from notes next to the document, other chapters searched,
  a path outside the folder (relative and absolute; nothing may leak), an
  unsaved draft with no folder at all, the override pointing elsewhere (the
  document folder's agent.md must then not apply), agent.md in zh and en
  (reply language, house style, comments stripped, global + project
  layers), library facts by alias and a character-consistency check, a
  `/skill` and a skill matched by description, a project skill shadowing a
  global one.
- **Writing-style learning**: "Learn my style" (`learn_style`) run on three
  samples each in zh and en; the profile is checked for the seven sections,
  the samples' language, examples quoted verbatim from the samples (so none
  are invented) and the habits the samples share (「」 quotes, no
  exclamation marks, short sentences; British spelling, second person, no
  semicolons). Then an edit and a completion under the learned profile,
  edits and completions under hand-written profiles with hard rules (a
  sentence-length limit, banned words, a punctuation habit), a profile in
  English applied to Chinese text and the reverse, and Quick Ask under a
  profile.
- **Completion (21 zh + 23 en + 16 other + 3 style)**: the same everyday
  genres; inside an open Chinese and English quote; poetry as one line per
  paragraph and as hard breaks; an empty paragraph after a heading and after
  a long section; list items, numbered steps and table cells; JS code; a
  list item and another block in every other matrix language (a Japanese
  list item among them).
- **Grammar (13 zh + 14 en + 8 other)**: 的/地/得, half-width punctuation in
  Chinese, homophone typos, measure words, mixed Chinese/English text,
  articles, agreement, tense, run-ons, correct dialect, British spelling and
  long sentences that must stay clean, and paragraphs with inline
  formatting (`**bold**`, `` `code` ``, links): the check gets the block's
  textContent, and every fix must not cut across bold or a link or touch
  code, and must write back into the Markdown with every marker intact.
  Long multi-mistake paragraphs in Korean and German.

**The documents are what the app shows.** The agent's documents are
Markdown fixtures in `live_eval/docs/` that `src/editor/eval-docs.test.ts`
round-trips through the real editor and `doc-markdown.ts`'s serializer in
CI: `*` bullets, padded tables, escaped `\$`, no trailing newline. (It also
showed that the editor writes a GitHub alert marker as `> \[!NOTE]` - see
Remaining weaknesses.) The `<cursor>` block mirrors `caretContext`: 160
characters of plain text either side, blocks separated by a newline.

### How a case is judged

**Automatic checks** (hard - a failure fails the test):

- Edit or no edit, as the request calls for; comments for reviews; every
  proposal validates on its first try (a rejected anchor costs the user a
  retry round trip).
- Reply language = the language of the user's message; the text an edit
  writes = the document's language (or a translation's target). Detected
  from script ratios, a 70-pair simplified/traditional character table and
  per-language word lists (`checks::detect`).
- **Byte identity outside the target**: the changed span of the document
  (common prefix/suffix) must lie inside the passage the request named.
- **Structure**: both versions are parsed with pulldown-cmark (GFM tables,
  task lists, footnotes, math, alerts, front matter) into a block skeleton;
  it must be unchanged, or changed by exactly the expected delta (one more
  row with three cells, one task checked, one more nested item). Links,
  inline math, footnote refs and code spans can be required to survive.
- Shorter/longer, required strings in the result, tools that must be
  called (read before editing a long document, `use_skill`, `read_file`),
  and per-case checks (the title follows the skill's house style, the
  footnote is a new ref plus a new definition, the new item is nested...).
- Completion: non-empty, no echo of the text before the cursor, no line
  break outside code, language, length bounds per mode, the word under the
  cursor finished correctly, a space where the language needs one,
  candidates count and distinctness (bigram similarity < 0.6).
- Grammar: the reply parses, every known mistake is flagged by an
  overlapping span, applying all suggestions yields the corrected text, no
  issue on protected spans, no extra issues beyond the case's allowance,
  issue descriptions in the paragraph's language.

**LLM judge** (reported, not asserted): Opus 5.5 grades faithfulness,
helpfulness, minimality, tone and correctness from 1 to 5 against a
task-specific rubric, with a sentence for every score below 5. Scores are
the quality signal to compare between runs; the summary flags any case with
a score of 2 or less.

## Running it

From `src-tauri/`:

```sh
LEVIS_ANTHROPIC_KEY_FILE=/path/to/key cargo test --lib live_eval -- --ignored --nocapture --test-threads=1
```

`--test-threads=1` runs the suites one after another; each suite runs six
cases at a time itself. Useful variables:

| Variable                   | Effect                                                                |
| -------------------------- | --------------------------------------------------------------------- |
| `LEVIS_EVAL_FILTER`        | Only cases whose id contains one of these comma-separated substrings  |
| `LEVIS_EVAL_AGENT_MODEL`   | Run the agent matrix on another model                                 |
| `LEVIS_EVAL_WRITING_MODEL` | Run completion and grammar on another model                           |
| `LEVIS_EVAL_JUDGE=0`       | Automatic checks only (much cheaper, about a third of the requests)   |
| `LEVIS_EVAL_JOBS`          | Concurrent cases (default 6)                                          |
| `LEVIS_EVAL_OUT`           | Output folder (default: a new folder under the system temp dir)       |
| `LEVIS_EVAL_BUDGET_USD`    | Stop starting cases once this run has spent this much (list prices)   |
| `LEVIS_EVAL_SPEND_FILE`    | A `{"spent_usd", "runs"}` ledger each finished suite adds its cost to |

Single suites: `cargo test --lib live_eval::live_agent_matrix -- --ignored --nocapture`
(also `live_completion_matrix`, `live_grammar_matrix`,
`live_agent_model_comparison`, `live_writing_model_comparison`,
`live_agent_caches_across_steps`, `live_lists_every_model`).
`live_eval::list_eval_cases` is free and needs no key: it prints every case
id per suite after `LEVIS_EVAL_FILTER`, for sizing a run before paying for it.

Every suite writes to the output folder:

- `<suite>.jsonl`, one row per case with everything needed to judge it
  without re-running: `input` (the document, the script of messages with
  cursor or selection and whether proposals were accepted, the mode, the
  workspace as built on disk and as loaded, style samples, the completion's
  before/after text, hints, tone and profile, the grammar paragraph and its
  Markdown) and `output` (per turn: the message as sent, the focus heading,
  every tool call with its arguments and result, proposals, rejected
  proposals and why, comments, the composed document diff and the document
  after; the learned profile; raw, returned and shown completions with how
  each reads in place; grammar issues, the corrected text and the corrected
  Markdown), the automatic checks, latency, and token usage with its cost.
- `<suite>.md`, the summary table, and `<suite>.usage.json`, the suite's
  token and dollar totals.
- `cases-index.json`, one row per case of every suite run into the folder:
  `{suite, id, group, model, lang, passed_checks, failed_checks}`.

A case that never reached the API (rate limit, spending limit) is marked
with a failed `request` check, and one the budget guard skipped with a
failed `budget` check; both are counted in a warning - those rows say
nothing about the prompts.

Budget: every request's usage is recorded and priced (Sonnet 5.5 $2 / $10
per million input / output tokens, cache writes $2.50 and reads $0.20;
Haiku 5.5 $0.10 / $0.50). With `LEVIS_EVAL_JUDGE=0` the round-2 baseline
cost about $0.01 for completion, $0.01 for grammar and a few dollars for
the 150 agent cases (see Results). Prefer `LEVIS_EVAL_FILTER` while
iterating, set `LEVIS_EVAL_BUDGET_USD`, and run the whole matrix before and
after a change. The test binary's artifact name doesn't depend on the
checkout, so with a target dir shared between worktrees, copy the built
binary somewhere private before a long run.

The checking code itself (language detection, the Markdown skeleton, edit
composition, region and similarity checks, the tone directives staying in
step with `completion-style.ts`) is unit-tested and runs in CI with
`cargo test`.

## Results

### Round 2 baseline (run1, automatic checks only)

Current `dev` with every 0.9.7 change, including round 1's prompt edits
(never verified live until now); agent Sonnet 5.5, writing Haiku 5.5,
`LEVIS_EVAL_JUDGE=0` (the scoring is done by reading the recorded rows).
Run at commit `8450f44`; the checker fixes listed below came after it.

| Suite      |    Pass | p50 / p90 ms | Requests |   Cost |
| ---------- | ------: | -----------: | -------: | -----: |
| completion |  88/106 |  1114 / 1932 |      106 | $0.012 |
| grammar    |   44/61 |  1192 / 2052 |       63 | $0.009 |
| agent      | 140/150 | 5774 / 12348 |      309 |  $3.03 |

What the checks caught:

- **Completion: round 1's "repeat the last word" instruction backfires on
  Haiku.** With thinking disabled, Haiku reasons in the visible reply:
  `zh/table-cell`, `en/social`, `style/en/rules`, `pt/list-item` and
  `ko/list-item` came back with "Wait - the instructions say...", '"and" is
  the last word, so I repeat it' or a stray `</reasoning_effort>`. Cut-off
  words are not repeated, so the fallback splits them: "docu ment", "cl
  early", "sala riés", "co sts" (all four `midword` cases). Whole headings
  are repeated ("Lessons from\nLessons from a ...", "Lecciones de Lecciones
  de ..."), and in Japanese the repeated word isn't cut ("常備常備薬"). A
  continuation that opens with inline code gets no space ("set
  the`max_retries`").
- **Grammar**: wrong spans that corrupt the sentence when applied ("has a
  an opinion", "what changed change"), no-op issues whose suggestion equals
  the span, partial recall on two-mistake paragraphs (的/得, articles,
  agreement, tense, the half-width comma), a reply with trailing reasoning
  that didn't parse twice (`ja/typo`), "the the" and an inline-code typo
  missed.
- **Agent**: scope creep (`cross/zh-asks-en-doc/formal` also rewrote the
  last line; `panel/en/five-turn` warmed and shortened the whole email when
  asked about "it"); "Learn my style" wrote the Chinese samples' profile in
  English (`style/zh/learn`, `style/zh/learned-applied`); asked to expand
  under a strict profile, the agent shortened (`style/zh/rules`). Workspace
  cases all passed - outside paths were refused and said so, the override,
  agent.md layers (comments stripped), library aliases and skills behaved.

Checker false positives in run1, fixed after it: `task/summary-into-doc`
(a summary starting with "The " moved the minimal diff's start past the
intro), `tech/en/rewrite-keep-code` (the region came from `para()`, which
splits the code block), `meeting/en/cursor-insert` and `lang/es|pt/mid`
(short text misread as Portuguese / English), `product/*/bullets` (a list
replacing a paragraph is re-bulleted by the editor), `ja/particles` (本が
見つかりました is a correct alternative), and the zh profile's habit
keywords (the profile was in English). Added after run1: completion checks
for doubled text at the cursor and for leaked meta-commentary (also on
grammar replies).

### Round 1

Defaults at the time: agent Sonnet 5.5, writing (completion and grammar)
Haiku 5.5. One run per configuration; judge means move by about ±0.1
between identical runs, so small differences are noise.

#### Agent (Sonnet 5.5, 75 cases)

|                                    |       Before |       After |
| ---------------------------------- | -----------: | ----------: |
| Cases passing every check          |        69/75 |       72/75 |
| Judge mean                         |         4.65 |        4.73 |
| Cases with a judge score ≤ 2       |            5 |           3 |
| Faithfulness                       |         4.43 |        4.63 |
| Helpfulness                        |         4.65 |        4.71 |
| Minimality                         |         4.81 |        4.85 |
| Tone                               |         4.63 |        4.59 |
| Correctness                        |         4.72 |        4.87 |
| Median / p90 latency per case (ms) | 4778 / 10049 | 5125 / 9710 |

"After" counts `md/table-add-row` and `md/nested-list-add` as passing: in
the after run their structure checks passed and the only failure was the
region check flagging a row added just past the table's last newline, a
checker bug fixed since (`check_region` now includes the line breaks
around the target).

By group (pass before → after, judge before → after): languages 22→22
(4.80→4.86), Markdown structures 16→19 (4.63→4.91), tasks 9→10
(4.70→4.66), cross-language and translation 3→3 (4.56→4.56), workspace
features (agent.md, style, library, skills, files, long document) 9→8
(4.44→4.47); the review, question, plan, ambiguous and multi-turn groups held.

What moved:

- `md/table-add-row`, `md/nested-list-add`, `task/expand` - the model's
  proposals were right all along (`insert_after` the last row with the new
  row; the WebSocket item with an indented sibling; the paragraph's last
  sentence with one more sentence). The frontend composed them wrongly:
  a blank line between the old and new row ended the table and left the
  new row as a paragraph of pipes; trimming the new item's indentation and
  adding a blank line un-nested it; and any insertion after a paragraph's
  last sentence became a paragraph of its own. Fixed in
  `composeMarkdownEdit` (see Changes); judge 3.0 / 2.8 / 4.2 → 4.8 / 5.0 /
  5.0.
- `cross/en-asks-zh-doc/shorten`: the reply followed the document into
  Chinese for an English request; after, it answers in English (4.0→4.8).
- `agentmd/zh-conventions`: the invitation paragraph invented "free, no
  preparation needed, come on Saturday"; after, no invented facts
  (3.8→5.0).
- `agentmd/reply-language-and-spelling` regressed: the new reply-language
  rule beat agent.md's "always reply in English" (3.4). The prompt now
  says a reply language set in agent.md overrides the rule - not yet
  re-run (see Remaining weaknesses).

#### Agent model comparison (17 cases)

|            | Before: pass | judge | p50 ms | output tokens | After: pass | judge | p50 ms |
| ---------- | -----------: | ----: | -----: | ------------: | ----------: | ----: | -----: |
| Haiku 5.5  |        14/17 |  4.31 |   5667 |        17,571 |       14/17 |  4.64 |   6181 |
| Sonnet 5.5 |        14/17 |  4.45 |   6952 |        10,349 |       15/17 |  4.68 |   7183 |
| Opus 5.5   |        14/17 |  4.61 |   6166 |         9,900 |    11/12 \* |  4.67 |   7435 |

\* Five of Opus's after-cases hit the workspace spending limit; the row
covers the twelve that ran.

Before tuning, Opus led clearly on quality (fewest invented details, best
tone) at a latency close to Sonnet's; Haiku wrote the most tokens and made
the structural mistakes (a summary written into the document, two
overlapping proposals that could not both apply). After tuning the three
are within judge noise of each other. **Decision: keep Sonnet 5.5 as the
agent default.** Opus costs twice as much per token for a difference the
tuned prompts erased; Haiku's after-tuning score is promising, but its
baseline failures were the kind the prompt only partly prevents, and 17
cases are too few to move the default to a model a tenth the price on.
Re-run the comparison with the full matrix
(`LEVIS_EVAL_AGENT_MODEL=claude-haiku-5-5`) before reconsidering.

#### Completion (Haiku 5.5, before only)

| Model      | Pass  | Judge | ≤ 2 | Correctness | p50 ms | p90 ms |
| ---------- | ----- | ----: | --: | ----------: | -----: | -----: |
| Haiku 5.5  | 17/39 |  4.10 |   7 |        3.41 |   1148 |   1745 |
| Sonnet 5.5 | 16/39 |  4.23 |   8 |        3.54 |   1508 |   2388 |

The dominant failure: **the model never starts its reply with a space**.
In 22 of the 23 cases in Latin- and Cyrillic-script languages, and in Korean, the
suggestion was glued to the last word - "it quickly" + "consumed" →
"quicklyconsumed" - whenever the writer paused right after a word. Sonnet
does the same, so a bigger model is no fix. The second: continuations
invented specifics ("a few megabytes", research findings by age group in a
field report, "volunteers" in a library story) because the prompt asked for
"the next concrete point, detail, example". Chinese and Japanese
continuations were otherwise good (4.0-5.0); one Chinese list item came
back as a non-word (常用 + 上药 → 常用上药, 2.8). In a code block, both
hint variants continued the code; the explicit `code block` hint scored
4.8 against 4.2. The after-run for this suite could not be made - the
workspace hit its spending limit (see Remaining weaknesses).

#### Grammar (before only)

| Model      | Pass  | Judge | ≤ 2 | p50 ms | p90 ms |
| ---------- | ----- | ----: | --: | -----: | -----: |
| Haiku 5.5  | 22/26 |  4.68 |   3 |   1210 |   2621 |
| Sonnet 5.5 | 25/26 |  4.98 |   0 |   2504 |   6178 |

Haiku's failures: in "typos" mode it reported a grammar fix ("go" →
"goes"); it missed 的 → 地 in 高兴的跳 (twice) and once returned a bare
`[10, …]` that isn't the issue array; deleting a doubled "the the" left a
double space; at "strict" it flagged a correct Chinese paragraph; for "nós
vai" it anchored the fix on the correct word, producing "nós vamos vai".
Sonnet is near perfect but twice as slow and twenty times the price, on a
check that fires on every paragraph edit. **Decision: keep Haiku 5.5 as
the writing default** and close the gap in the prompt (below); revisit if
the after-run still shows the scope and particle misses.

## Changes made

All in the files this evaluation owns, plus two frontend fixes where the
eval proved the frontend - not the model - was at fault.

1. **Edit composition** (`src/ai/doc-markdown.ts`, `composeMarkdownEdit`;
   mirrored in `checks.rs`). A new row or list item next to a whole row or
   item line now joins its table or list with a single newline, keeping a
   nested item's indentation. In a paragraph, a new block is only started
   when the text is block content or the anchor is the whole paragraph -
   a sentence after its last sentence joins it. Every other block (a
   heading, list, table, quote, fence) keeps the old rule: text at its edge
   starts a block of its own, since a sentence glued onto a table row
   becomes a cell (before the header row, it dissolves the table) and onto
   a heading or the last item becomes part of them. The `propose_edit`
   description says the same. Unit tests in `doc-markdown.test.ts`, and an
   e2e test that accepts a new row and a nested item in the real editor
   (`e2e/visual.spec.ts`).
2. **Completion spacing** (`client.rs`, `fit_to_cursor` /
   `finish_completion`). The prompt now has the model repeat the last word
   before the cursor when the text ends in one (completing it if it is
   cut off), and the backend cuts the repetition off again: a cut-off word
   gets finished ("docu" + "document is" → "ment is"), a finished word gets
   its space (" grew"), and a model that skipped the repetition still gets
   the space a new word needs. A word with an apostrophe, hyphen or dot is
   matched whole ("don't", "C'est", "well-known", "3.5") - never just the
   letters after its apostrophe, which would cut them off the next word. A
   reply that is only the repeated word adds nothing. Unspaced scripts
   (Chinese, Japanese, Thai and their neighbours) get nothing added; code
   indentation at a line start, and a code continuation that opens with a
   newline, are kept. Each alternative of a manual trigger starts on the
   line after its separator, and the editor's `splitCandidates` takes only
   whole lines with the separator, so the alternatives keep their joining
   space too. The rule is deterministic and unit tested because the model
   alone never produced the space.
3. **Completion content** (`COMPLETION_INSTRUCTIONS`). "Move the text
   forward" now means with what the text supports - finish the thought,
   the consequence it sets up, the step it promises - and never invent
   figures, names, dates, findings or quotes. A code block is completed as
   code in its language and indentation, and the editor now sends
   `code block` as the block hint (`ghost-text-plugin.ts`).
4. **Grammar** (`GRAMMAR_INSTRUCTIONS`, `strictness_instructions`). A span
   is never a correct word next to the mistake; deleting a word takes a
   neighbouring space with it; "typos" spells out that agreement, verb form,
   tense and word choice are grammar and out of scope, and that a
   wrong-script character is a typo; "standard" names particles and
   function words (Chinese 的/地/得) and doubled or missing words; "strict"
   says a correct paragraph still gets `[]`. `ai_grammar_check` retries
   once when the reply doesn't parse.
5. **Agent prompt** (`AGENT_ROLE`, `AGENT_TOOL_INSTRUCTIONS` in
   `agent.rs`):
   - Reply in the language of the user's message, not the document's and
     not a translation's target (with that example); a reply language in
     agent.md overrides this.
   - Never add facts the author hasn't given; expanding or making vivid
     means sharper wording and consequences of what is there; say what is
     missing instead of inventing it; fiction may invent when asked,
     consistent with the text and library. Shortening cuts words, not
     information. Describe changes accurately.
   - Information requests phrased as commands ("summarize this") are
     answered in the reply unless the user asks for it in the document;
     "prefer an edit" now only applies to messages ambiguous between
     changing the document and talking about it.
   - Read first, propose after - never in the same step as the read the
     edit depends on (Opus proposed from the notes file before reading it).
   - How to add a table row or list item; one proposal per passage, since
     overlapping proposals can't all be applied (Haiku sent two).

No sampling or token defaults changed: Sonnet 5.5 and Haiku 5.5 reject a
non-default temperature, the 16k agent / 4k completion output limits were
never hit, and latency was acceptable (agent median ~5 s per request,
completion ~1.1 s).

## Remaining weaknesses

- **Round 1's completion prompt change is now verified live, and it
  misfires** (round 2 baseline above): Haiku, with thinking disabled,
  doesn't repeat a cut-off word (so the fallback splits it), repeats whole
  headings, repeats words in Japanese where nothing cuts them, and in five
  cases wrote its reasoning about the instruction into the suggestion.
- The two agent prompt edits made after round 1's last run (agent.md's
  reply language overriding the default rule; the translation example)
  passed their automatic checks in the round 2 baseline
  (`agentmd/reply-language-and-spelling`, `translate/en-to-es-paragraph`);
  their judge scores are pending.
- Faithfulness is still the lowest agent criterion (4.63): the judge keeps
  finding small inventions in "make it vivid", "continue" and style-bound
  expansions, and replies that overstate what was kept. `style/profile-followed`
  (3.8) wrote two sentences over the profile's 14-word limit while the
  reply claimed compliance.
- `ask/why-question-zh` (3.2-3.8): answers to "why did I write this" pad
  with speculation about the author's intent.
- (Fixed.) A frontend bug found while writing the e2e test: with two
  pending proposals, accepting the earlier one first left the later
  preview at its old position whenever the first edit changed the
  document's length - its widget drifted off its text and its Accept
  refused. Accepting applies the edit and removes its preview in one
  transaction, and `pending-edit-plugin.ts`'s remove branch didn't map the
  other previews through it. It does now; the e2e test accepts top-down,
  and a second one checks that a pending replace's strike also follows
  typing above it (the strike range was never mapped either).
- (Fixed in round 2.) The eval documents used `-` bullets and minimal table
  rules while the editor shows `*` and padded tables; they are now fixtures
  checked byte-exact against the editor. The prompt still tells the model to
  write `-` list items, so a new item in a `*` list can start a second list
  (`report/zh/add-risk`, `product/*/bullets` and `md/nested-list-add` check
  for it).
- The editor writes a GitHub alert's marker escaped - `> [!NOTE]` comes back
  as `> \[!NOTE]` both in the saved file and in the text the AI sees - so a
  saved alert no longer renders as one on GitHub. Found by the fixture test;
  not fixed here (editor code).
- The evaluation is one sample per case. Before trusting a difference of
  less than ~0.2 in a judge mean, run twice.
- Not covered: web search, image attachments, providers other than
  Anthropic, and the tool-less fallback path.

## Recommendations

- Run the completion and grammar suites as soon as the limit resets, then
  the full matrix, and record the after-columns here.
- Prompt text in files owned by other work (not changed here):
  - `project.rs`, `writing_context_section`: make the style profile's
    concrete limits binding - for example
    `---the author's style profile (follow it when writing for this project; its concrete limits, such as sentence length and words to avoid, are hard rules)---` -
    since the agent treated them as suggestions and then claimed it had
    met them.
  - `project.rs`, the library header: add "do not add facts about them that
    the library and the text don't give" - before tuning, the agent gave a
    library character an invented fifteen-year back story.
  - `project.rs`, `STYLE_INSTRUCTIONS`: add an eval case for `learn_style`
    (samples in, profile checked for the seven sections, quoted examples
    present verbatim in the samples) before changing it.
- Consider Haiku 5.5 as a cheaper agent option in Settings' model list
  description once the full matrix confirms the after-tuning parity.
- Grammar on Sonnet 5.5 is markedly better; if users complain about the
  checker, offering it as an opt-in "thorough" model is the next lever.
