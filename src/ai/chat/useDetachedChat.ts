import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { windowIpc } from "../../ipc";
import { listenToThisWindow, unlistenAll } from "../../utils/tauri-events";
import type { AgentTurn, EditProposal } from "../types";
import type { PendingStatus } from "../usePendingEdits";
import {
  CHAT_TO_EDITOR,
  CHAT_WINDOWS_CHANGED,
  EDITOR_TO_CHAT,
  onWindowEvent,
  sendToWindow,
  type BulkDecisionMessage,
  type CallIdMessage,
  type ChatContext,
  type ChatHandoffState,
  type ProposalsMessage,
  type ReembedMessage,
} from "./chat-bridge";

/**
 * Which chat window this WEBVIEW is talking to.
 *
 * Module-level rather than React state because every tab in a window is a
 * separate mounted MilkdownEditor in one JS realm, and they must agree: the
 * chat window is shared across files, so a tab that never detached anything
 * itself still has to know where to push its context when it becomes the
 * active one. Per-tab state left every tab but the one that clicked "detach"
 * believing no chat was open, which is why only that one file's document ever
 * reached the window.
 */
let sharedChatLabel: string | null = null;
const labelListeners = new Set<() => void>();

function getSharedChatLabel() {
  return sharedChatLabel;
}

function setSharedChatLabel(next: string | null) {
  if (sharedChatLabel === next) return;
  sharedChatLabel = next;
  for (const listener of labelListeners) listener();
}

function subscribeChatLabel(listener: () => void) {
  labelListeners.add(listener);
  return () => {
    labelListeners.delete(listener);
  };
}

/** Asks Rust which chat window serves this editor window. Covers the case a
 *  local store cannot: with cross-window sharing on, the chat may have been
 *  opened from - or closed by - a DIFFERENT window entirely, so this webview
 *  never saw it happen. */
async function refreshChatLabel() {
  try {
    setSharedChatLabel(await windowIpc.currentChatWindow());
  } catch {
    // No backend (dev shim) - leave whatever the local store has.
  }
}

/**
 * Keeps the store honest, once per WEBVIEW rather than once per tab.
 *
 * Every open tab mounts its own `useDetachedChat`, so subscribing from the
 * hook meant N identical IPC round trips (each taking Rust's registry mutex)
 * every time the window was focused, N-1 of them resolving to the value the
 * store already had. This registers on the first subscriber and tears down
 * with the last.
 *
 * Rust announces registry changes (CHAT_WINDOWS_CHANGED) because it is the
 * only party that knows about them - a chat window closed from another editor
 * window is invisible here, and pushing context at a destroyed label fails
 * silently. Window focus is kept as a cheap backstop for anything the event
 * misses.
 */
let watchers = 0;
let stopWatching: (() => void) | null = null;

function watchChatWindows(): () => void {
  if (watchers++ === 0) {
    const onFocus = () => void refreshChatLabel();
    window.addEventListener("focus", onFocus);
    const unlisten = listenToThisWindow(CHAT_WINDOWS_CHANGED, () => {
      void refreshChatLabel();
    });
    stopWatching = () => {
      window.removeEventListener("focus", onFocus);
      void unlisten.then((f) => f());
    };
    void refreshChatLabel();
  }
  return () => {
    if (--watchers === 0) {
      stopWatching?.();
      stopWatching = null;
    }
  };
}

export interface DetachedChatHandlers {
  onProposals: (
    proposals: { callId: string; proposal: EditProposal }[],
    docPath: string | null,
  ) => void;
  onAccept: (callId: string, docPath: string | null) => void;
  onReject: (callId: string, docPath: string | null) => void;
  onAcceptAll: (docPath: string | null) => void;
  onRejectAll: (docPath: string | null) => void;
  /** The chat window closed and handed its conversation back. */
  onReembed: (conversationId: string, turns: AgentTurn[]) => void;
  /** The chat is about to send and wants the document as it reads NOW. */
  onContextRequest: () => void;
}

/**
 * The editor's half of the detached-chat bridge.
 *
 * Authority stays here: the chat window renders a conversation and asks for
 * things, but every proposal is still resolved and applied by this window's
 * usePendingEdits. That is the whole reason the bridge forwards calls rather
 * than shipping state - a second copy of the anchor/apply logic living in
 * another window is exactly the kind of drift the 0.7.2 rework removed.
 */
export function useDetachedChat(handlers: DetachedChatHandlers) {
  const chatLabel = useSyncExternalStore(
    subscribeChatLabel,
    getSharedChatLabel,
  );
  // Handlers change identity every render; the listeners are registered once,
  // so they read through a ref rather than re-subscribing constantly.
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    return unlistenAll(
      onWindowEvent<ProposalsMessage>(CHAT_TO_EDITOR.proposals, (payload) =>
        latest.current.onProposals(payload.proposals, payload.docPath),
      ),
      onWindowEvent<CallIdMessage>(CHAT_TO_EDITOR.accept, (payload) =>
        latest.current.onAccept(payload.callId, payload.docPath),
      ),
      onWindowEvent<CallIdMessage>(CHAT_TO_EDITOR.reject, (payload) =>
        latest.current.onReject(payload.callId, payload.docPath),
      ),
      onWindowEvent<BulkDecisionMessage>(CHAT_TO_EDITOR.acceptAll, (payload) =>
        latest.current.onAcceptAll(payload.docPath),
      ),
      onWindowEvent<BulkDecisionMessage>(CHAT_TO_EDITOR.rejectAll, (payload) =>
        latest.current.onRejectAll(payload.docPath),
      ),
      onWindowEvent(CHAT_TO_EDITOR.requestContext, () =>
        latest.current.onContextRequest(),
      ),
      onWindowEvent<ReembedMessage>(CHAT_TO_EDITOR.reembed, (payload) => {
        setSharedChatLabel(null);
        latest.current.onReembed(payload.conversationId, payload.turns ?? []);
      }),
    );
  }, []);

  useEffect(watchChatWindows, []);

  /** Pops the chat out, or reveals the one already open. Resolves once the
   *  window exists. */
  const detach = useCallback(
    async (
      state: ChatHandoffState,
      title: string,
      /** Both are live settings read at this instant, not carried in `state`:
       *  the window reads `pinAgentWindow` from the shared settings store
       *  itself, and Rust needs `shared` to scope the registry entry. */
      options: { shared: boolean; pinned: boolean },
    ) => {
      const win = getCurrentWindow();
      let position: [number, number] | null = null;
      try {
        // Open beside the editor rather than on top of it - the reason to
        // detach is to stop the chat covering the document.
        const [pos, size, scale] = await Promise.all([
          win.outerPosition(),
          win.outerSize(),
          win.scaleFactor(),
        ]);
        position = [(pos.x + size.width) / scale + 12, pos.y / scale];
      } catch {
        // No bounds available - let the platform place it.
      }
      const label = await windowIpc.detachChatWindow({
        state,
        position,
        title,
        shared: options.shared,
        pinned: options.pinned,
      });
      setSharedChatLabel(label);
      return label;
    },
    [],
  );

  /** Pushes the document and selection as they now read, so the chat shows
   *  the file the user is actually in and a send never goes out against a
   *  stale snapshot. Also re-addresses the chat to this window (the context
   *  carries `editorLabel`). */
  const pushContext = useCallback(
    (context: ChatContext) => {
      if (chatLabel) sendToWindow(chatLabel, EDITOR_TO_CHAT.context, context);
    },
    [chatLabel],
  );

  const pushStatuses = useCallback(
    (statuses: Record<string, PendingStatus>) => {
      if (chatLabel) sendToWindow(chatLabel, EDITOR_TO_CHAT.statuses, statuses);
    },
    [chatLabel],
  );

  const closeDetached = useCallback(() => {
    void windowIpc.closeChatWindow();
    setSharedChatLabel(null);
  }, []);

  return {
    /** Non-null while a detached chat window serves this editor window. */
    chatLabel,
    detach,
    pushContext,
    pushStatuses,
    closeDetached,
  };
}
