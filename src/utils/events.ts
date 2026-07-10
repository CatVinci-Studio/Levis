/// Shared window CustomEvent names for wiring global keyboard shortcuts
/// (handled in App.tsx) to the currently mounted editor instance
/// (MilkdownEditor.tsx) without a direct import between the two.
export const TRIGGER_COMPLETION_EVENT = "levis:trigger-completion";
export const TRIGGER_GRAMMAR_CHECK_EVENT = "levis:trigger-grammar-check";
export const TOGGLE_FLOATING_CHAT_EVENT = "levis:toggle-floating-chat";

/// detail: the markdown text to insert at the cursor (clipboard history panel).
export const INSERT_CLIPBOARD_TEXT_EVENT = "levis:insert-clipboard-text";
