# AI evaluation

How every AI feature in Levis is evaluated against the real Anthropic API,
what the first full evaluation found, what was changed because of it, and
what is still weak. The suite lives in `src-tauri/src/ai/live_eval.rs` and
`src-tauri/src/ai/live_eval/`; this document is its guide and its record.

## Concepts

One folder used to go by three names - "project folder" in the AI panel and
the tools, "Workspace Folder" in Settings, "the document's folder" in the
prompt - and agent.md by three more, so the agent made up its own ("I'm in
read-only mode", "I have no tool to open files"). The names below follow the
concept model of PR #42 (`docs/AI-CONCEPTS.md` there), which brings the UI
and the in-app guide in line in en, zh and ja; since round 2 the agent is
told the same names and what each thing is (`agent.rs`'s
`workspace_section`).

| Concept                                                      | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                              | Where it lives                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Project folder** (项目文件夹; in code, the workspace root) | The one folder Levis AI may read (`list_files`, `read_file`, `search_files`, @-mentions), and whose `.levis/` folder configures the documents in it. The open document's own folder by default (`RootSource::DocumentFolder`), or one the user chose (`Chosen`). An unsaved draft with no chosen folder has none (`None`): no file tools are offered, and the agent says why and how to fix it. A home folder or drive root is never used (`TooBroad`). | The folder row at the top of the AI panel (Choose project folder…), or Settings > Levis AI; resolved by `workspace::load_from` |
| **Writing instructions** (写作要求, agent.md)                | Standing instructions sent with every conversation: the global ones, then the project's.                                                                                                                                                                                                                                                                                                                                                                | App config `agent/agent.md`; `.levis/agent.md`                                                                                 |
| **Skills** (技能)                                            | Reusable instructions: the index (name + description) is in the prompt, the body loads with `use_skill` - or arrives already expanded in a `<skill name="...">` block when the user types `/name`. A project skill shadows a global one of the same name.                                                                                                                                                                                               | `agent/skills/*.md`; `.levis/skills/*.md`                                                                                      |
| **Library** (资料库)                                         | Facts about characters, places and terms. An entry is sent when the request, selection or text around the cursor mentions its name or an alias (`include: detected`), always, or never. It is a constraint on what is written, not text to recite.                                                                                                                                                                                                      | `.levis/library/*.md`                                                                                                          |
| **Style profile** (文风档案)                                 | How the author writes - voice, sentence rhythm, word choice, punctuation, what they never do - which both the agent and inline completion follow for every document in the project folder. Its concrete limits (sentence length, banned words or punctuation) are rules; its habits apply where they read naturally and never override the request (an expansion still gets longer) or the sense of the text.                                           | `.levis/style.md`                                                                                                              |
| **Writing-style learning** ("Learn my style", 学习我的文风)  | Drafts the style profile from samples of the author's own writing (`project::learn_style`, `STYLE_INSTRUCTIONS`), in the samples' language, headings included; the author reviews and edits it in a tab. The previous profile is kept as `style.previous.md`.                                                                                                                                                                                           | The folder row's menu in the AI panel                                                                                          |
| **Completion tone**                                          | A preset register for inline completion only (formal, casual, academic, concise), the same in every document. It sets the register; the style profile is the author's own voice.                                                                                                                                                                                                                                                                        | Settings > Levis AI > Writing Assistance (`completion-style.ts`)                                                               |
| **Ask / Edit / Plan mode** (询问 / 编辑 / 计划)              | The panel's modes: Ask reads, answers and comments, with no edit tool; Edit can propose edits; Plan writes a plan without editing. An edit asked for in Ask mode gets the text in the reply and a pointer to Edit mode.                                                                                                                                                                                                                                 | The composer's mode picker                                                                                                     |
| **Quick Ask**                                                | The chat bar under the current paragraph: the same agent and prompt, opened in Edit mode on the selection it captured; each follow-up is sent against that range as mapped through accepted edits.                                                                                                                                                                                                                                                      | Cmd+Shift+K                                                                                                                    |

## What is evaluated

Each case goes through the app's real code path: the same system prompts,
tool definitions, agent loop, completion and grammar prompts, and the same
post-processing (`finish_completion`, `finish_grammar`). Where the
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
| `completion` |   105 | Round 1 (43 cases): Every tone preset (default, formal, casual, academic, concise) on English mid-sentence, English long continuation and Chinese after-sentence text; mid-sentence in every matrix language; list item (en, zh), table cell, heading (en, zh), blockquote; a Python code block with the `code block` hint the editor sends (round 2 dropped the old `paragraph`-hint variant); after-text (manual trigger mid-document); three candidates (en, zh); the cursor inside a word (en, fr, de); a nearly empty document.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
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
- Agent replies (round 2): no tool names or line numbers ("第91行") in what
  the writer reads; in Chinese and Japanese replies, no ASCII `, : ; ( ) "`
  against CJK text; the reply's language is detected without what it
  quotes (an English reply about a Chinese edit quotes Chinese).
- Completion: non-empty, no echo of the text before the cursor (and no
  text doubled at the join, `checks::doubled_at_join`), no leaked
  meta-commentary, no line break outside code, no figure the context
  doesn't have (`checks::new_numbers`), language, length bounds per mode
  (alternatives included), the word under the cursor finished correctly, a
  space where the language needs one, candidates count and distinctness
  (bigram similarity < 0.6).
- Grammar: the reply parses, every known mistake is flagged by an
  overlapping span, applying all suggestions yields the corrected text and
  writes nothing twice ("a an", "uns uns", "高兴的高兴地" -
  `checks::doubled_words`), no issue on protected spans, no extra issues
  beyond the case's allowance, issue descriptions in the paragraph's
  language. A fix inside inline code is dropped first, as the editor drops
  it (`touchesCode`).

**Judging** (reported, not asserted). Round 1 had Opus 5.5 grade
faithfulness, helpfulness, minimality, tone and correctness from 1 to 5
against each case's rubric, through the API. Since round 2 the runs use
`LEVIS_EVAL_JUDGE=0` and the grading is done by Claude subagents reading the
recorded rows (`<suite>.jsonl` carries everything a judge needs: input,
every tool call and result, the composed diff, the shown completion, the
applied grammar fixes, and the rubric), on the same five criteria with a
verdict (good / acceptable / bad), the problems quoted, and a likely cause.
That keeps the API spend to the cases themselves: the judge requests were
about two thirds of round 1's. The API judge (`harness::judge`) is still
there for runs that want it.

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
the 150 agent cases (see Results); an agent case averages about $0.02-0.03.
Prefer `LEVIS_EVAL_FILTER` while iterating, set `LEVIS_EVAL_BUDGET_USD`,
and run the whole matrix before and after a change. Completion and grammar
cost about a cent per full suite, so iterate on them with the whole suite.
The test binary's artifact name doesn't depend on the checkout, so with a
target dir shared between worktrees, copy the built binary somewhere
private before a long run - or give each worktree its own target dir:
round 2 had a shared one hand back another worktree's build of `aicompat`
mid-session.

The checking code itself (language detection, the Markdown skeleton, edit
composition, region and similarity checks, the tone directives staying in
step with `completion-style.ts`) is unit-tested and runs in CI with
`cargo test`.

## Results

### Round 2 after the fixes (run2)

Branch `fix/ai-eval-round2`, agent Sonnet 5.5, writing Haiku 5.5,
`LEVIS_EVAL_JUDGE=0`, output in `levis-shots/ai-eval/run2`. Completion and
grammar were re-run whole (a cent each; the join and parsing changes touch
every case). The agent re-run covers the 61 cases that failed a check or
that the run1 judges didn't rate good, plus 16 that were good as a
regression guard (agent Markdown edits, files, library, long document,
outside-path refusal, agent.md reply language, a Quick Ask five-turn).

| Suite      | run1 (checks of 8f8173d) |   run2 |  p50 / p90 ms (run1 → run2) |   Cost |
| ---------- | -----------------------: | -----: | --------------------------: | -----: |
| completion |                   88/106 | 98/105 |    1114 / 1932 → 985 / 1634 | $0.014 |
| grammar    |                    44/61 |  59/61 |   1192 / 2052 → 1172 / 1989 | $0.009 |
| agent (77) |                    67/77 |  74/77 | 6838 / 13401 → 6464 / 18390 |  $2.03 |

run1's agent column counts the same 77 cases. The three agent failures
were fixed after the run and re-run in `run2/followup` (6/6, $0.19, with
three neighbouring multi-edit cases): `agentmd/zh/reply-english-file`
replied in English as agent.md asks but quoted so much Chinese that the
language check misread it (checker fix: quotes are left out);
`essay/en/vivid` proposed the same paragraph twice in one reply (the
`propose_edit` result now says it is the proposal for that passage);
`panel/en/five-turn`'s third message, "Add that we've already lined up a
second supplier", named no paragraph, and the agent's own turn-2 offer
("I can also soften the next paragraph") made "that paragraph" ambiguous
too - the case now says "the first paragraph". After that, the prompt's
project section was renamed to PR #42's terms (project folder, writing
instructions; where to change the folder in the UI, with the Chinese labels)
and corrected to list three panel modes; the project-folder, Ask-mode,
files and library cases were re-run on it (`run2/followup2`, 12/12, and
`run2/followup3`, the two unsaved drafts, 2/2).

What changed, read from the rows:

- **Completion**: no reasoning reaches the writer. One raw reply still
  reasoned (`en/report-summary`, correcting its own invented cause over
  three paragraphs) and was dropped whole; one ended in
  `</reasoning_effort>` (`block/zh-list-item`), which the cleanup removed.
  With the word at the cursor in its own tag, the model wrote it out in 42
  of the 46 cases whose text ends in a word (11 of 46 with run1's "repeat
  the last word", one of them inside a leak), and every doubled join is
  gone (常用常用, 安卓端的安卓端的, 结果结果, Lessons from Lessons from,
  Lecciones de Lecciones de, 常備常備, 止むまで、止むまで). The remaining failures
  are empty suggestions: the model went on mid-word without writing the
  word out ("docu" + "ument", "Berufst" + "ätige") or skipped "the", and
  the join won't guess (two midword cases, `en/tech-doc`), a one-word
  heading answered with the word alone (`ru/heading`), plus one wrong word
  ("freight co" + "ntaining") and one long list item (`ko/list-item`).
- **Grammar**: the corrected-paragraph-first contract recovered the
  second instance of a mistake type (`en/tense` buy, `en/missing-articles`
  the history, `en/agreement-two`, `ru/case-two`'s first case error),
  `de/multi-long` now fixes all three, and no applied fix writes text
  twice. The instruction-shaped paragraph ("Run npm instal and read the
  offical setup guide before you start.") is checked instead of answered.
  Still missed: "find it" -> "find them" across a clause, and Russian "о
  истории" -> "об истории".
- **Agent**: replies are shorter (mean 286 -> 211 characters on the same
  cases), start with the answer, say "proposed" and rest on the measured
  size ("cut from 68 words to 43"); no routing narration ("这是个问题，不是
  修改请求") or line numbers in any reply. Chinese replies use “ ” and
  full-width punctuation. The Chinese style profile is written in Chinese
  (`style/zh/learn`, Chinese headings, bullets that count: "两个句号之间的内容
  多数不超过十五个字。三篇里只有开头一句（18字）……略长"), an expansion under a 20-character profile now comes out longer
  and in two paragraphs, edits stay in their paragraph
  (`cross/zh-asks-en-doc/formal`), "make it warmer" stays on the paragraph
  of the turn before, a "three sentences" limit is met by cutting, `/skill` no
  longer reloads the skill (one round trip less), the library is used as a
  constraint instead of recited, and the unsaved-draft cases say why
  ("这份文档还没保存，也没有选择项目文件夹") and what to do (paste it, save
  the document next to the notes, or choose a project folder in the AI
  panel's folder row). Ask mode names Edit
  mode as the way to apply a change. The p90 rose because learning a style
  in Chinese writes about twice the tokens (CJK text, longer bullets) and
  two cases hit slow API responses; the median fell.

Spend: round 2's fix work cost $5.20 at list prices - the run2 runs above
($2.06), the three follow-ups ($0.41), and development runs on the way
(`dev/`: three completion and three grammar suites, $0.07; agent subsets
of 6, 77 and 10 cases, $2.67). With the baseline, this workflow spent
$8.26 of its $20 (the ledger is `levis-shots/ai-eval/spend.json`).
Judging: subagents, no API cost.

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

### Round 2

Grouped by root cause, each fixed at the layer where it lives. Every
deterministic change has unit tests (`client.rs`, `checks.rs`, `agent.rs`,
`harness.rs`, `doc-markdown.test.ts`, `grammar-check-plugin.test.ts`,
`chat/proposal.test.ts`).

1. **Completion: the join** (`client.rs`). The model no longer decides
   whether to repeat a word. `word_at_cursor` takes the word the cursor is
   in or right after out of `<text-before-cursor>` into its own
   `<word-at-cursor>` tag - a written word with its inner apostrophes,
   hyphens and dots ("don't", "3.5", "2,300"), or a short elision ("l'",
   "qu'") - and the prompt says to start by writing that word out in full.
   `fit_to_cursor` then cuts off the longest echo of the before-text that
   the reply opens with: whole words in spaced scripts (so a two-word
   heading echo goes too), two or more characters after Chinese or
   Japanese (`echoed_len` - the frontend's `stripEcho` only takes six or
   more). When the model went on without writing the word out and letters
   follow, nobody can tell "and" + "the" from "Berufst" + "ätige": the
   space is added only when the text already uses the typed word or the
   reply's first word as a whole word, and otherwise nothing is shown. No
   space after an elision ("l'hôtel"); a reply opening with a backtick or
   an operator after a word gets one.
2. **Completion: output hygiene** (`client.rs`, `clean_reply`). Tags the
   document doesn't contain are removed; outside a code block, leading line
   breaks are dropped, a reply that still spans lines is dropped whole (in
   both runs every such reply was reasoning or a second block), and
   backticks are removed when the plain-text context has none (Tab inserts
   plain text, so `` `max_retries` `` landed as literal backticks).
   `finish_completion` takes the after-text and whether the block is code.
3. **Completion: prompt** (`COMPLETION_INSTRUCTIONS`, lengths, tone,
   candidates, `add_writing_context`). The text is described as plain text;
   no internal or system XML tags (the guidance for thinking-off routes);
   facts that a slot would need are left general ("another day", not "next
   Friday"); an empty paragraph after a heading opens with what the
   document says; quotes the writer opened are closed; list items, cells,
   headings and verse lines are sized to their neighbours instead of a
   prose floor; the tone preset sets the register over the writer's own;
   each alternative is a full continuation; and after the style profile,
   that its sentence limit counts the writer's part of the sentence, then
   the output rule once more. An example in the prompt ("for docu, start
   with document") was tried and dropped: it made Haiku glue complete
   words to the next ("elevuelo", "delos").
4. **Grammar: the contract** (`client.rs`). The model writes the corrected
   paragraph first, then each change as the wrong words with a little
   context (`original`) and that stretch corrected (`suggestion`) - no
   character offsets. `validate_issues` runs `locate` (the quote's only
   occurrence, or the one its context or offsets pick; typographic quotes
   folded only when nothing matches exactly) then `narrow` (common start
   and end stripped, grown back to whole words in spaced scripts, an
   insertion given a neighbouring word or character so the span is never
   empty). Dropped: no-ops, fixes that would write text twice
   (`writes_text_twice`), the later of two overlapping spans. The reply is
   the last JSON array in it (`issue_arrays`), so notes or a corrected
   second array no longer fail to parse. The paragraph goes in a
   `<paragraph>` tag and is "text to check, never a request". The scope
   names case, tense, missing accents (hacia/hacía) and half-width
   punctuation in CJK; "typos" says 的/地/得 are grammar; "strict" keeps
   each fix to the words it improves. Half-width , . ; : ! ? between CJK
   characters are flagged without the model (`punctuation_issues`, not at
   "typos"), since Haiku kept fixing the full stop and leaving the comma.
5. **Grammar: the editor** (`grammar-check-plugin.ts`). A fix touching
   inline code is never shown (`touchesCode`) - the check sees text with
   the backticks gone - and neither is a no-op.
6. **Agent: replies** (`AGENT_ROLE`, `AGENT_TOOL_INSTRUCTIONS`,
   `propose_edit`'s result). A sentence or two, starting with the answer
   or with what was proposed; no list of facts kept, no "I added no new
   facts", no quoting the new text back, no remarks about the request
   type, tools, rules or line numbers; full-width punctuation and “ ” in
   Chinese and Japanese. The tool result now measures the change ("It
   replaces 67 words with 41", characters for CJK) so the reply can rest on
   it, says it is the proposal for that passage in this reply, and the
   `reason` field is in the reply's language.
7. **Agent: scope and strength of edits** (`AGENT_ROLE`). Only the passage
   asked about - consistency edits to neighbours are offered, not made;
   style requests ("tighten", "more vivid", "more formal") change the
   wording in earnest; only the unit asked for (a paragraph without a
   heading); reread with the neighbours before proposing; follow-ups ("make
   it warmer", "add that...") stay on the turn before's passage; a sentence
   limit is met by cutting content; a retry after a rejection keeps the
   rejected draft's gains.
8. **Agent: invented facts, recalibrated** (`AGENT_ROLE`). Checkable facts
   (names, numbers, dates, events, causes, outcomes, plans, quotes) stay
   forbidden; rendering what the text already implies - the senses of an
   action, the feeling a situation carries - is allowed, and an expansion
   must come out longer. Missing facts are asked for in the reply, not
   written into the document as placeholders. Stance words survive a
   shortening (only, 就, 被迫). Dialogue asked for in fiction is dialogue.
9. **Concepts: the project folder and the modes** (`agent.rs`'s
   `workspace_section`, `workspace::RootSource`). The agent is told which
   folder it can read and why - the document's folder, the user's choice,
   none because the draft is unsaved, or none because the folder is too
   broad - with the UI's names and where to change it (the AI panel's
   folder row, Choose project folder… / 选择项目文件夹…, or Settings >
   Levis AI), and what to tell the user; the file tools are only mentioned
   when they are offered. It also learns what the writing instructions,
   skills, the library, the style profile, "Learn my style" and the
   Ask/Edit/Plan modes are called. Ask mode names Edit mode as the way to
   apply a change. The names follow PR #42's concept model; renaming the
   UI and the guide is left to that PR. (A first version here called the
   folder "workspace folder" in the tools and the UI, opposite to #42; it
   was reverted before the PR and the project-folder cases were re-run,
   `run2/followup2` and `followup3`, 14/14.)
10. **Style learning and the style profile** (`project.rs`). The profile is
    written in the samples' language, headings included (with the Chinese
    heading set given), and its bullets must hold for the samples ("count
    instead of estimating"). The profile's prompt header says what it is
    and how it binds - limits are rules, habits give way to the request
    and to sense - and the library header says to use entries as
    constraints, not text to recite.
11. **Frontend composition**. `/skill` expands into a `<skill name>` block
    the prompt recognises as already loaded (`proposal.ts`, mirrored by the
    eval). A footnote reference joins its word without a space
    (`joinInline`, mirrored in `checks.rs`).
12. **Checker and cases**. New checks listed under How a case is judged.
    Language detection abstains on no evidence or a tie (short Spanish,
    French and Portuguese were read as English), and the reply-language
    check leaves quotes out. The grammar extras list shows only the extras.
    `diff_view` marks whole words and cut context ("…"). Cases:
    `zh/measure-word` no longer protects the non-standard 两件裤子 (now
    两条裤子); `ja/typo` accepts かったです; `fr/auxiliary` expects "nous
    sommes allés" so a leftover auxiliary fails; the unsaved-draft cases
    also need the reason or the fix; `md/footnote-add` checks the reference
    is attached; `panel/en/five-turn` says which paragraph its third
    message means; the obsolete `paragraph`-hint code case is gone.

### Round 1

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

- **Completion, cut-off words**: when the model goes on mid-word without
  writing the word out ("docu" + "ument"), the join shows nothing rather
  than guess; the same happens after a complete word the text never used
  before ("set the" + "retry_limit"). Safe, but a lost suggestion - in
  run2, 4 of 46 completions after a word. Invented figures are gone from
  run2 (the new "no new figures" check passed everywhere), but Haiku still
  fills some slots with specifics it wasn't given: "下周五" in the
  rescheduling email (the prompt's own example is "another day, not next
  Friday"), what the new reading room holds, "memory use didn't change".
  It answers a one-word heading with the word alone, and once returned a
  wrong word ("freight co" + "ntaining").
- **Grammar recall** on agreement across clauses ("the notes ... find it")
  and Russian preposition forms (о/об) is still missed by Haiku; Sonnet
  catches more (round 1), at twice the latency.
- **Agent, reply habits**: "I added no new facts" still appears where the
  user asked not to invent ("make it vivid, but don't invent anything"),
  and the agent sometimes adds a small unrequested commitment while
  disclosing it ("so this shouldn't happen again"). Self-reported counts
  now come from the tool result, but descriptions of character-level
  Chinese edits in English replies can still be loose.
- **Agent, re-proposing**: twice in development runs the agent proposed a
  passage, reconsidered, and proposed it again in the same reply; the two
  proposals overlap and only one can be applied. The tool result now says
  it is the proposal for that passage, which held in the follow-up run;
  the frontend still shows both if it happens.
- **Platform rules**: a tweet length is counted in raw characters, while X
  counts a link as 23 (`social/en/tweet`).
- **The `<cursor>` block** is cut at 160 characters without snapping to a
  word, and blocks are joined with one newline (headings lose their `#`).
  The agent copes; a Markdown-based window would be safer.
- **Tables in completion context**: the editor flattens a table into one
  cell per line, so a cell completion can't see its row or column.
- The editor writes a GitHub alert's marker escaped - `> [!NOTE]` comes back
  as `> \[!NOTE]` both in the saved file and in the text the AI sees - so a
  saved alert no longer renders as one on GitHub. Found by the fixture test;
  not fixed here (editor code).
- The evaluation is one sample per case, and the round-2 agent re-run
  covers 77 of 150 cases. Before trusting a small difference, run twice.
- Not covered: web search, image attachments, providers other than
  Anthropic, and the tool-less fallback path.
- (Fixed in round 2.) Round 1's "repeat the last word" completion rule, the
  half-width punctuation and routing narration in replies, the English
  profile for Chinese samples, the shrinking expansion under a strict
  profile, scope creep "for consistency", the `-` bullet instruction in a
  `*` document (the prompt now says to use the document's marker), and the
  missing workspace explanation for unsaved drafts - see Changes made.
- (Fixed in round 1.) Accepting the earlier of two pending proposals left
  the later preview at its old position whenever the first edit changed
  the document's length; `pending-edit-plugin.ts`'s remove branch now maps
  the other previews through it, and so does a pending replace's strike.

## Recommendations

- Have the subagent judges grade run2 (`levis-shots/ai-eval/run2`) with
  the same rubric as run1 and record the verdict counts here; then run
  the other 73 agent cases once, to confirm nothing outside the re-run set
  moved.
- Completion: if the empty suggestions after a cut-off word matter in
  use, a second request for those cases only (a few per hundred) would
  recover them; a stop sequence on "\n\n" would also end leaked reasoning
  earlier, at a lower latency.
- Grammar on Sonnet 5.5 is markedly better on recall; if users complain
  about the checker, offering it as an opt-in "thorough" model is the next
  lever.
- Consider Haiku 5.5 as a cheaper agent option in Settings' model list
  description once the full matrix confirms the after-tuning parity.
