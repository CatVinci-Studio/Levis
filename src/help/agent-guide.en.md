# Levis AI Features Guide

Levis has a built-in AI made for writing, Levis AI: completion, grammar checking, and conversations that read and revise your document. This guide covers connecting a service, the AI features, and how to shape Levis AI into your own writing assistant with a project folder, writing instructions and skills.

## Connecting a service

1. Open **Settings > AI** and choose the service you want under **Connection > Provider**.
2. Expand **Login & credentials** and sign in to your account or enter an API key, whichever that service supports.
3. For a **Custom Endpoint** (any OpenAI-compatible server: local models, proxies), enter the base URL, a key if it needs one, and the model name, then save.
4. Pick the writing model under **Writing Assistance** and the chat model under **Levis AI Chat**.

Signing in happens in your browser. Whether images, web search and document edits are available depends on the service and model you choose.

The built-in model list only holds each provider's defaults (for Anthropic: Claude Sonnet 5.5 for chat, Claude Haiku 5.5 for completion and grammar). Press **Fetch Models** on the Model List row under **Connection** to load the provider's current list and choose any model from it.

Shortcuts below use macOS notation; on Windows and Linux, read Cmd as Ctrl and Option as Alt. If you have changed a shortcut, **Settings > Shortcuts** has the current one.

## The AI features

### 1. Completion

As you type, a gray continuation appears at the cursor — press <kbd>Tab</kbd> to accept it, or <kbd>Cmd</kbd>+<kbd>→</kbd> to accept just the next word and keep the rest on offer. <kbd>Esc</kbd> dismisses it. There's no minimum amount of text required; it's ready from the very first sentence of a document.

Ask for one explicitly with <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> or the context menu (the cursor must be at the end of a paragraph): you get a longer continuation with up to three alternatives — <kbd>Option</kbd>+<kbd>[</kbd> / <kbd>Option</kbd>+<kbd>]</kbd> cycle through them.

Under **Settings > AI > Writing Assistance** you can pick a **completion tone** (match the document / formal / casual / academic / concise). When the document belongs to a project with a style profile or library (see below), completion follows them too.

### 2. Grammar check

Possible issues get underlined. Hover over one, or move the caret into it, to see the explanation; **Apply** (or <kbd>Option</kbd>+<kbd>Enter</kbd> with the caret on it) takes the fix, **Ignore** dismisses it. <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> checks the current paragraph immediately.

### 3. The AI panel

The full conversation lives in a panel on the right side of the editor. Open or close it with the chat button at the right end of the window bar or <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>.

- **One conversation per document**: each tab has its own conversation, and switching tabs switches the panel with it. **New conversation** in the panel's header starts over (with edits still undecided, it asks first).
- **Modes**: the composer has **Ask**, **Edit** and **Plan**. The panel starts in the mode set under **Settings > AI > Levis AI Chat > Default mode**.
- **@-mentions**: type `@` in the input to pick a text file from the project folder; it is attached to the message.
- **Attach files**: the **+** button on the left of the input attaches a PDF, Word document, PowerPoint deck, spreadsheet, image, or plain text file to that message. Everything except images is extracted to text locally and travels inside the message; images are sent as real images to providers that can see (ones that can't say so up front rather than dropping them silently). A long file is sent only in part, and the chip says "(shortened)" when that happens.
- **Web search**: once enabled in **Settings > AI > Levis AI Chat** (for providers that offer it), Levis AI can search the web on its own when a request needs it.
- **History**: the sidebar's **Chats** tab stores past conversations. Click one to reopen it in the current editor and continue.
- **Errors**: when a request fails, the chat says what kind of problem it is and what to do (check the key, wait a moment, pick another model) above the provider's own message.

**Open in a separate window** in the panel's header moves the conversation into its own window — handy on a second monitor. That window follows you: switch tabs or windows and its document, title and selection follow, and the edits it proposes land in whichever file you are actually editing. There is only ever one per editor window; **📌** in its header keeps it above the editor.

### 4. Quick Ask

Press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> (or right-click > Ask AI…) to open a small chat bar right below the paragraph you are in. It sits in the document, pushing the text below it down rather than covering it. If text was selected when you opened it, the selection is included. Quick Ask opens in **Edit** mode, because it is usually opened on a passage to change it ("shorten this"); Ask is one click away in the mode picker.

- **The shortcut again**: pressing <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> while the bar is open moves the cursor to its input; pressing it once more from the input closes it. <kbd>Esc</kbd> anywhere in the bar closes it too, and the cursor goes back to the document. With edits still undecided, closing (or starting a new conversation) asks first.
- Quick Ask keeps its own short conversation, separate from the panel's and not saved to History. It opens even while the panel is open. **Continue in the full conversation** (the button in its corner) hands the exchange to the AI panel, where it carries on and is saved. Turn on **Settings > AI > Advanced > Open full conversations in a separate window** to send it to a separate window instead.

### 5. Edits in the document

The chat never writes to your document directly. When you ask a tool-calling provider to change the document, each change is a proposal shown right where it would land: removed text is struck through, new text appears as a green insert. Nothing touches the document until you accept, and <kbd>Cmd</kbd>+<kbd>Z</kbd> undoes an accepted edit in one step.

- **Accept / Reject**: from the floating bar next to the edit, the proposal's card in the panel, or the keyboard — <kbd>Cmd</kbd>+<kbd>Return</kbd> accepts, <kbd>Cmd</kbd>+<kbd>Delete</kbd> with the caret on the edit rejects. Several proposals in one reply preview at once; step between them with ‹› and use Accept all / Reject all.
- **Reasons**: each proposal card says why Levis AI made that change.
- **Only some sentences**: when a proposal rewrites several sentences, its card offers "N sentence changes · choose" — tick the ones you want and press **Accept selected**.
- **At the cursor**: with nothing selected, Levis AI knows where your cursor is, so "write a transition here" inserts exactly there.
- **Comments instead of edits**: ask for a review ("what's weak here?") and Levis AI pins comments to passages without changing them. Each comment card has **Show in document**, which selects the passage it is about.

## The project folder

When a document is saved, **its folder is the project**. Levis AI can list, read and search the text files in it (Markdown, plain text, and similar formats) to find a character's earlier scenes, a term, or your notes. Hidden files and folders, build and dependency folders (such as `node_modules`), and files over 100 KB are left out. An unsaved draft has no project, and a folder that is too broad — your home folder or a whole drive — is refused.

The bar under the AI panel's header shows the project. Its menu can **Choose project folder…** (for when your reference material doesn't live next to the draft), go back with **Use the document's folder**, or **Show in file manager**. The same choice is under **Settings > AI > Workspace Folder**. Everything Levis AI reads must be inside the project: `..`, absolute paths, and symlinks pointing outside are refused.

The project also holds two writing aids in its `.levis/` folder:

```
my-novel/
├── chapter-1.md
└── .levis/
    ├── style.md          ← your style profile
    └── library/
        ├── lin-wan.md    ← one entry per character, place or term
        └── harbour-city.md
```

### style.md — your voice

A description of how you write: voice and tone, sentence rhythm, word choice, things you never do. Levis AI and completion follow it for every document in the project. Create it from the project menu (**Create style profile**), or use **Learn my style from samples…**: pick a few files of your own writing and the AI drafts the profile from them, then opens it in a new tab for you to review and edit (the previous profile is kept as `style.previous.md`).

### library/ — facts to keep straight

One Markdown file per character, place or term (**New library entry…** in the project menu creates one):

```markdown
---
name: Lin Wan
aliases: [Wan, Ms Lin]
include: detected
---

Protagonist, 32, teaches Chinese at a secondary school...
```

You don't attach entries yourself. An entry with `include: detected` (the default) is given to the AI automatically whenever its name or an alias appears in your message, the selection, or the text around the cursor; `always` sends it with every request and `never` keeps it out. A large library costs nothing until an entry is relevant.

## Writing instructions and skills

Instructions and skills live in the same `.levis/` folder:

```
my-novel/
├── chapter-1.md       ← the document being edited
└── .levis/
    ├── agent.md       ← standing instructions: style, glossary, project background
    └── skills/
        ├── polish.md  ← one skill per file
        └── outline.md
```

There is also a **global layer** with the same structure that applies to every document (**Settings > AI > Global Config Folder**). A workspace skill with the same name overrides the global one.

### agent.md — standing instructions

Whatever you write in `agent.md` is given to Levis AI in every chat. Good candidates: requirements for the reply, what the project is, rules Levis AI should always follow.

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
2. **Automatically** (tool-calling providers only): Levis AI knows every skill's name and description, and when your request matches one, it loads and follows the full instructions by itself.

> [!NOTE]
> Files in `.levis/` take effect without a restart — Levis AI's next request uses the new content (completion picks it up within a few seconds).

## A note on privacy

Your document, attached and @-mentioned files, workspace instructions, the style profile, relevant library entries, and any project files Levis AI reads are sent to the provider you selected as part of each request. Web search runs on that provider's servers. Turn any feature off in Settings when you don't want that.
