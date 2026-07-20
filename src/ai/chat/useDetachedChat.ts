import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { windowIpc } from "../../ipc";
import type { AgentTurn, EditProposal } from "../types";
import type { PendingStatus } from "../usePendingEdits";
import {
  CHAT_TO_EDITOR,
  EDITOR_TO_CHAT,
  onWindowEvent,
  sendToWindow,
  type CallIdMessage,
  type ChatContext,
  type ProposalsMessage,
} from "./chat-bridge";

export interface DetachedChatHandlers {
  onProposals: (
    proposals: { callId: string; proposal: EditProposal }[],
  ) => void;
  onAccept: (callId: string) => void;
  onReject: (callId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  /** The chat window closed and handed its conversation back. */
  onReembed: (turns: AgentTurn[]) => void;
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
  const [chatLabel, setChatLabel] = useState<string | null>(null);
  // Handlers change identity every render; the listeners are registered once,
  // so they read through a ref rather than re-subscribing constantly.
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const subscriptions = [
      onWindowEvent<ProposalsMessage>(CHAT_TO_EDITOR.proposals, (payload) =>
        latest.current.onProposals(payload.proposals),
      ),
      onWindowEvent<CallIdMessage>(CHAT_TO_EDITOR.accept, (payload) =>
        latest.current.onAccept(payload.callId),
      ),
      onWindowEvent<CallIdMessage>(CHAT_TO_EDITOR.reject, (payload) =>
        latest.current.onReject(payload.callId),
      ),
      onWindowEvent(CHAT_TO_EDITOR.acceptAll, () =>
        latest.current.onAcceptAll(),
      ),
      onWindowEvent(CHAT_TO_EDITOR.rejectAll, () =>
        latest.current.onRejectAll(),
      ),
      onWindowEvent<{ turns: AgentTurn[] }>(
        CHAT_TO_EDITOR.reembed,
        (payload) => {
          setChatLabel(null);
          latest.current.onReembed(payload.turns ?? []);
        },
      ),
    ];
    return () => {
      for (const sub of subscriptions) void sub.then((f) => f());
    };
  }, []);

  /** Pops the chat out. Resolves once the window exists. */
  const detach = useCallback(
    async (
      state: {
        context: ChatContext;
        turns: AgentTurn[];
        statuses: Record<string, PendingStatus>;
      },
      title: string,
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
      });
      setChatLabel(label);
      return label;
    },
    [],
  );

  /** Pushes the document as it now reads, so a send from the detached window
   *  never goes out against a stale snapshot. */
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
    setChatLabel(null);
  }, []);

  return {
    /** Non-null while a detached chat window is open for this editor. */
    chatLabel,
    detach,
    pushContext,
    pushStatuses,
    closeDetached,
  };
}
