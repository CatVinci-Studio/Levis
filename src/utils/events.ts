/// Shared window CustomEvent names for wiring global keyboard shortcuts
/// (handled in App.tsx) to the currently mounted editor instance
/// (MilkdownEditor.tsx) without a direct import between the two.
export const TRIGGER_COMPLETION_EVENT = "levis:trigger-completion";
export const TRIGGER_GRAMMAR_CHECK_EVENT = "levis:trigger-grammar-check";
export const TOGGLE_FLOATING_CHAT_EVENT = "levis:toggle-floating-chat";
export const TOGGLE_FIND_REPLACE_EVENT = "levis:toggle-find-replace";

/// detail: the markdown text to insert at the cursor (clipboard history panel).
export const INSERT_CLIPBOARD_TEXT_EVENT = "levis:insert-clipboard-text";

/// detail: a ChatHistoryEntry to load as the live conversation and open the
/// inline chat on (chat history sidebar panel).
export const RESTORE_CHAT_EVENT = "levis:restore-chat";

/// detail: the block kind to insert at the cursor, from the native Format
/// menu (see menu-insert-block in src-tauri/src/lib.rs) - "h1".."h6",
/// "bullet-list", "ordered-list", "blockquote", "code-block", or "table".
export const INSERT_BLOCK_EVENT = "levis:insert-block";

/// Fired once a chat message actually goes out (InlineChat.tsx's send), not
/// just when the chat panel opens - the interactive tutorial's "ask AI
/// something" step listens for this to know the user really did it. Only
/// the tutorial's own mock chat dispatches it (InlineChat's tutorialMock
/// prop), so sends in other tabs never advance the tour.
export const AI_MESSAGE_SENT_EVENT = "levis:ai-message-sent";

/// Fired after the first-run Agent editing exercise has produced a real
/// in-document proposal preview. The lesson waits for this rather than the
/// earlier message-sent event, so it never tells the learner to accept a
/// change before the preview actually exists.
export const TUTORIAL_AGENT_PROPOSAL_EVENT = "levis:tutorial-agent-proposal";

/// detail: the suggestion string. The tutorial's completion step showing a
/// PRE-WRITTEN ghost suggestion at the caret (ghost-text-plugin's
/// showGhostSuggestion) - first-run users have no AI account yet, so the
/// tour never calls the real backend.
export const TUTORIAL_MOCK_GHOST_EVENT = "levis:tutorial-mock-ghost";

/// detail: a TutorialGrammarMock (tutorial-evaluation.ts) - the practice
/// sentence plus issues with sentence-relative offsets. The tutorial's
/// grammar step underlining a PRE-WRITTEN issue in the practice paragraph
/// (grammar-check-plugin's showGrammarIssues, after the consumer re-bases
/// the offsets onto the cursor's paragraph) - same no-backend reasoning as
/// the ghost event above.
export const TUTORIAL_MOCK_GRAMMAR_EVENT = "levis:tutorial-mock-grammar";
