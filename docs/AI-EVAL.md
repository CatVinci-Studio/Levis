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

| Suite        | Cases | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------ | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`      |    75 | **Languages**: one report in en, zh-Hans, zh-Hant, ja, ko, es, fr, de, ru, pt and mixed Chinese/English, each asked a question and asked to tighten a paragraph; requests in a different language from the document; translation (whole paragraph, and a selection). **Markdown**: edit a table cell, add a table row, fix a bug in fenced Python and JS, check off a task (en, ja), add a nested list item, fix display math, add a footnote, shorten a GitHub alert, change a link, edit YAML front matter, raw HTML, a Mermaid diagram, rename a heading, rewrite a paragraph that carries a link, inline math and a footnote ref, change an image's alt text, answer a question about the document. **Agent behaviour**: summarise (in chat, and into the document), expand, rewrite formally, delete a sentence, continue, replace a selection, insert at the cursor (en, zh) and inside a sentence, review with comments (edit mode and ask mode), questions that must not become edits, plan mode, two ambiguous requests, three multi-turn follow-ups (accept then "same again", reject then retry, question then act), agent.md (reply language + spelling; Chinese conventions), the style profile, the library (a fact by alias; character consistency), a `/skill` and a skill matched by description, facts from a project file, one section of a 60k-character document. |
| `completion` |    43 | Every tone preset (default, formal, casual, academic, concise) on English mid-sentence, English long continuation and Chinese after-sentence text; mid-sentence in every matrix language; list item (en, zh), table cell, heading (en, zh), blockquote; a Python code block with the hint the editor sends today and with the new `code block` hint; after-text (manual trigger mid-document); three candidates (en, zh); the cursor inside a word (en, fr, de); a nearly empty document.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `grammar`    |    26 | Each strictness level on real mistakes and on correct text (where any report is a false positive); typos (en, zh, zh-Hant wrong script, ja, ko), grammar (en, zh 的/地, fr, de, es, ru, pt), code tokens / URLs / math / names / dialogue that must be left alone, "typos" mode on a paragraph that also has a grammar mistake, strict mode on wordy text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| model runs   |       | `agent-models`: 17 agent cases (one of each kind) on Haiku 5.5, Sonnet 5.5 and Opus 5.5. `completion-models` / `grammar-models`: both suites on Haiku 5.5 and Sonnet 5.5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

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

| Variable                   | Effect                                                               |
| -------------------------- | -------------------------------------------------------------------- |
| `LEVIS_EVAL_FILTER`        | Only cases whose id contains one of these comma-separated substrings |
| `LEVIS_EVAL_AGENT_MODEL`   | Run the agent matrix on another model                                |
| `LEVIS_EVAL_WRITING_MODEL` | Run completion and grammar on another model                          |
| `LEVIS_EVAL_JUDGE=0`       | Automatic checks only (much cheaper, about a third of the requests)  |
| `LEVIS_EVAL_JOBS`          | Concurrent cases (default 6)                                         |
| `LEVIS_EVAL_OUT`           | Output folder (default: a new folder under the system temp dir)      |

Single suites: `cargo test --lib live_eval::live_agent_matrix -- --ignored --nocapture`
(also `live_completion_matrix`, `live_grammar_matrix`,
`live_agent_model_comparison`, `live_writing_model_comparison`,
`live_agent_caches_across_steps`, `live_lists_every_model`).

Every suite writes `<suite>.jsonl` (each case's full output: replies, tool
calls, proposals, diffs, raw completions, issues, checks and judge reasons)
and `<suite>.md` (the summary table) to the output folder, and prints the
summary. A case that never reached the API (rate limit, spending limit) is
marked with a failed `request` check and counted in a warning - those rows
say nothing about the prompts.

Budget: a full run of everything is several hundred model requests plus a judge
call per case. Two and a half full runs exhausted a workspace limit during this
work, so prefer `LEVIS_EVAL_FILTER` and `LEVIS_EVAL_JUDGE=0` while
iterating, and run the whole matrix before and after a change.

The checking code itself (language detection, the Markdown skeleton, edit
composition, region and similarity checks, the tone directives staying in
step with `completion-style.ts`) is unit-tested and runs in CI with
`cargo test`.

## Results

Defaults at the time: agent Sonnet 5.5, writing (completion and grammar)
Haiku 5.5. One run per configuration; judge means move by about ±0.1
between identical runs, so small differences are noise.

### Agent (Sonnet 5.5, 75 cases)

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

### Agent model comparison (17 cases)

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

### Completion (Haiku 5.5, before only)

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

### Grammar (before only)

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
   nested item's indentation; a new block is only started when the text is
   block content or the anchor is the whole block; anything else -
   including a sentence after a paragraph's last sentence - joins the
   paragraph. The `propose_edit` description says the same. Unit tests in
   `doc-markdown.test.ts`, and an e2e test that accepts a new row and a
   nested item in the real editor (`e2e/visual.spec.ts`).
2. **Completion spacing** (`client.rs`, `fit_to_cursor` /
   `finish_completion`). The prompt now has the model repeat the last word
   before the cursor when the text ends in one (completing it if it is
   cut off), and the backend cuts the repetition off again: a cut-off word
   gets finished ("docu" + "document is" → "ment is"), a finished word gets
   its space (" grew"), and a model that skipped the repetition still gets
   the space a new word needs. Unspaced scripts get nothing added; code
   indentation at a line start is kept. The rule is deterministic and unit
   tested because the model alone never produced the space.
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

- **Completion and grammar changes are not yet verified live.** The
  workspace's spending limit was reached before their after-run (it resets
  on 2026-11-01). The spacing fix is deterministic and unit tested, but
  the "repeat the last word" instruction is new to the model: run
  `LEVIS_EVAL_FILTER=midword,tone,lang,candidates cargo test --lib live_eval::live_completion_matrix -- --ignored --nocapture`
  and `live_grammar_matrix` first. If the model doesn't follow the
  instruction, the fallback still adds the space at word boundaries but
  would split a word the writer stopped in the middle of.
- **Two agent prompt edits made after the last run** (agent.md's reply
  language overriding the default rule; the translation example) are also
  unverified. `agentmd/reply-language-and-spelling` and
  `translate/en-to-es-paragraph` are the cases to watch; the translation
  reply was still in Spanish in the after run.
- Faithfulness is still the lowest agent criterion (4.63): the judge keeps
  finding small inventions in "make it vivid", "continue" and style-bound
  expansions, and replies that overstate what was kept. `style/profile-followed`
  (3.8) wrote two sentences over the profile's 14-word limit while the
  reply claimed compliance.
- `ask/why-question-zh` (3.2-3.8): answers to "why did I write this" pad
  with speculation about the author's intent.
- **A frontend bug found while writing the e2e test, not fixed here**: with
  two pending block-level proposals (two paragraph `replace`s, or a list
  edit and a paragraph edit), accepting the earlier one first moves the
  later preview onto the next block and its Accept then refuses; accepting
  from the bottom up works. The likely cause is how
  `pending-edit-plugin.ts` maps a preview's range through the
  `replaceRange` that `applyEditRange` makes for the first block. The new
  e2e test accepts bottom-up to stay on its own subject.
- The eval documents use `-` bullets, while the editor serializes lists
  with `*` - the model sees `*` in the app. The composition rules treat both
  the same, but the cases are not a byte-exact replica of what the app
  shows.
- The evaluation is one sample per case. Before trusting a difference of
  less than ~0.2 in a judge mean, run twice.
- Not covered: the "Learn my style" profile generation (`learn_style`), web
  search, image attachments, providers other than Anthropic, and the
  tool-less fallback path.

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
