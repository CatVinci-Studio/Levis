# Levis AI Features Guide

Levis has a built-in AI agent made for writing. This document covers signing in, the AI features, and how to shape the agent into your own writing assistant with an Agent Workspace.

> [!TIP]
> Every AI feature can be toggled individually in **Settings > AI**, which also has a full list of providers to sign in to or configure — pick whichever is active with the **Use** button.

## Signing in / choosing a provider

**Settings > AI** lists every provider as a row you can expand to sign in or configure, and switch between with its **Use** button:

| Provider | Notes |
| --- | --- |
| **ChatGPT (Codex)** | Sign in with your ChatGPT account (browser authorization, no API key). Tool calling (edit proposals, file reading, dynamic skills) and web search. |
| **OpenAI API Key** | Paste a standard OpenAI API key. Same tool calling and web search as ChatGPT. |
| **Claude** | Sign in with your Claude account (browser authorization). Tool calling (edit proposals, file reading, dynamic skills) — no web search yet. |
| **Custom Endpoint** | Any OpenAI-compatible endpoint (local models, proxies): enter the base URL, an optional key, then fetch or type the model name. No tool calling yet — the agent replies in plain text instead of proposing edits. |

"Sign in with ChatGPT" / "Sign in with Claude" opens your browser for authorization; once you approve, you're done.

## The AI features

### 1. Completion

As you type, a gray continuation appears at the cursor — press <kbd>Tab</kbd> to accept it. There's no minimum amount of text required; it's ready from the very first sentence of a document. You can also trigger it manually with <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> or the context menu.

In **Settings > AI** you can pick a **completion tone** (formal / casual / academic / concise) and add free-form **completion instructions** (e.g. "never use em dashes") that ride along with every request.

### 2. Grammar check

Possible issues get underlined; hover to see the explanation and apply the fix with one click. <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> checks the current paragraph immediately.

### 3. Ask AI (the chat popup)

Press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> (or right-click > Ask AI) to open a chat at the cursor. It knows the whole document, and if text was selected when you opened it, the selection is included as context.

- **History**: the clock icon in the popup's header opens a dropdown of your past conversations in this document — click one to pick it back up. The sidebar's Chats tab shows the same list.
- **New chat**: the **+** button in the header starts a fresh conversation without closing the popup.
- **Attach files**: the **+** button on the left of the input attaches any text file to that message (research notes, an outline, another chapter).
- **Web search**: once enabled in Settings (ChatGPT and OpenAI API Key providers), the agent can search the web on its own when a request needs it.
- **Workspace files**: for saved documents, a tool-calling provider (ChatGPT, API Key, or Claude) can list and read files in the document's folder by itself — keep reference material next to the document.

### 4. In-document edit previews

When you ask a tool-calling provider (ChatGPT, OpenAI API Key, or Claude) to change the document, its proposal shows up right where the change would land: removed text is struck through, new text appears as a green ghost-style insert. A small floating panel with **✓ Accept** / **✗ Reject** appears next to it — keyboard shortcuts <kbd>Cmd</kbd>+<kbd>Return</kbd> / <kbd>Cmd</kbd>+<kbd>Delete</kbd> do the same. Nothing touches the document until you accept, and <kbd>Cmd</kbd>+<kbd>Z</kbd> undoes an accepted edit in one step. The chat popup's card for that proposal mirrors the same Accept/Reject buttons and shows a status once resolved.

Multiple proposals in one reply preview at once; the floating panel shows "1 of N" with ‹› to step between them, plus Accept all / Reject all.

## The Agent Workspace

Different writing projects need different instructions, skills, and reference files. A workspace is simply **the folder containing your document**, configured with a `.levis/` directory inside it:

```
my-novel/
├── chapter-1.md       ← the document being edited
├── .levis/
│   ├── agent.md       ← standing instructions: style, glossary, project background
│   └── skills/
│       ├── polish.md  ← one skill per file
│       └── outline.md
└── research/
    └── worldbuilding.md   ← reference material the agent can read on its own
```

There is also a **global layer** with the same structure that applies to every document (Settings > AI > Agent Workspace > Open Global Folder). A workspace skill with the same name overrides the global one.

### agent.md — standing instructions

Whatever you write in `agent.md` is given to the agent in every chat. Good candidates: style requirements, a glossary of names and terms, what the project is.

### skills/ — skills

One skill = one Markdown file: YAML metadata at the top, the full instructions below.

```markdown
---
name: polish
description: Tighten the selected passage without changing its meaning
---

Polish the given text sentence by sentence: cut redundant words,
split overlong sentences, and keep the original meaning and voice.
Output only the polished text.
```

Skills trigger two ways:

1. **Manually**: type `/` in the chat input and pick from the menu (or type `/polish take another look at this`).
2. **Automatically** (tool-calling providers only): the agent knows every skill's name and description, and when your request matches one, it loads and follows the full instructions by itself.

> [!NOTE]
> Skill files take effect immediately — the next chat you open uses the new content, no restart needed.

## A note on privacy

Your document, attached files, and workspace instructions are sent to the provider you selected as part of each request. Web search runs on OpenAI's servers. Turn any feature off in Settings when you don't want that.
