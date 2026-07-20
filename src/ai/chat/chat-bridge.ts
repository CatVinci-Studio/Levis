import { emitTo, listen } from "@tauri-apps/api/event";
import type { AgentTurn, EditProposal } from "../types";
import type { PendingStatus } from "../usePendingEdits";

/**
 * The protocol between an editor window and its detached chat window.
 *
 * The split is deliberate and one-directional in authority: the EDITOR
 * remains the sole owner of the document and of pending edits. A detached
 * chat window renders a conversation and asks for things; it never writes to
 * a document, never resolves an anchor, and holds no preview state of its
 * own. That keeps the "one place edits are applied" property the embedded
 * panel already has (see usePendingEdits) instead of growing a second
 * implementation that could drift.
 *
 * Transport is Tauri's window-targeted events (`emitTo`), so no Rust relay is
 * involved - the backend only creates the window and hands over the initial
 * state (commands/chat_window.rs).
 */

/** Chat -> editor. */
export const CHAT_TO_EDITOR = {
  proposals: "chat:proposals",
  accept: "chat:accept",
  reject: "chat:reject",
  acceptAll: "chat:accept-all",
  rejectAll: "chat:reject-all",
  /** The chat window is going away; the editor re-embeds the panel. */
  reembed: "chat:reembed",
  /** Chat needs the document as it reads right now, before sending. */
  requestContext: "chat:request-context",
} as const;

/** Editor -> chat. */
export const EDITOR_TO_CHAT = {
  context: "chat:context",
  statuses: "chat:statuses",
} as const;

/** The editor's current document state, pushed to the chat window. */
export interface ChatContext {
  /** Document as markdown source - see doc-markdown.ts. */
  document: string;
  /** Selection as plain text, for the composer's chip. */
  selectedText: string | null;
  /** Selection as markdown - what actually rides with the request. */
  selectionMarkdown: string | null;
  docPath: string | null;
}

/** Everything a detaching panel hands to its new window. */
export interface ChatHandoffState {
  context: ChatContext;
  /** Carried across so the conversation keeps ONE id through detach and
   *  re-embed - minting a new one each hop scatters a single exchange over
   *  several sidebar history entries. */
  conversationId: string;
  turns: AgentTurn[];
  /** Statuses of proposals already on screen, so a detached window doesn't
   *  show every past card as freshly pending. */
  statuses: Record<string, PendingStatus>;
}

export interface ChatHandoff {
  editorLabel: string;
  state: ChatHandoffState;
}

export interface ProposalsMessage {
  proposals: { callId: string; proposal: EditProposal }[];
}

export interface CallIdMessage {
  callId: string;
}

/** Sent back when the detached window closes, so the editor can resume the
 *  same conversation in the embedded panel. */
export interface ReembedMessage {
  conversationId: string;
  turns: AgentTurn[];
}

/** Typed `emitTo` - keeps event name and payload shape together. */
export function sendToWindow<T>(
  label: string,
  event: string,
  payload?: T,
): void {
  void emitTo(label, event, payload);
}

/** Typed `listen`, returning the same unlisten-promise shape callers already
 *  clean up elsewhere in this codebase. */
export function onWindowEvent<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  return listen<T>(event, (e) => handler(e.payload));
}
