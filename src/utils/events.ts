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
