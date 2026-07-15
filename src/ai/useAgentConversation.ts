import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { conversationTitle, saveConversation, type ChatHistoryEntry } from "./chat-history";
import type { AgentTurn } from "./types";

/// Multi-turn agent conversation state/logic backing the inline chat bar
/// (see InlineChatBar) against the `ai_agent_message` backend command -
/// pulled out on its own so any other agent surface added later can reuse
/// the same history bookkeeping instead of reimplementing it.
///
/// Lives above the chat bar itself (see MilkdownEditor) so the conversation
/// survives the bar being closed and reopened - closing the popup shouldn't
/// end the conversation; the "new chat" button does that via `reset`. The
/// document is passed per send, not held here, so each message sees the
/// document as it was when the bar was opened.
export function useAgentConversation(
  docPath: string | null,
  provider: string,
  webSearch: boolean,
  model: string | undefined,
) {
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
  const [history, setHistory] = useState<AgentTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every exchange updates the conversation's saved copy, so past chats can
  // be reopened from the History list even across restarts.
  useEffect(() => {
    if (history.length === 0) return;
    saveConversation({
      id: conversationId,
      docPath,
      title: conversationTitle(history),
      updatedAt: Date.now(),
      turns: history,
    });
  }, [history, conversationId, docPath]);

  async function send(document: string, message: string) {
    const trimmed = message.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const newTurns = await invoke<AgentTurn[]>("ai_agent_message", {
        provider,
        document,
        docPath,
        history,
        message: trimmed,
        webSearch,
        model: model || null,
      });
      setHistory((prev) => [...prev, ...newTurns]);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setConversationId(crypto.randomUUID());
    setHistory([]);
    setError(null);
  }

  /** Restores a saved conversation as the live one - sending continues it. */
  function restore(entry: ChatHistoryEntry) {
    setConversationId(entry.id);
    setHistory(entry.turns);
    setError(null);
  }

  return { history, busy, error, send, reset, restore };
}

export type AgentConversation = ReturnType<typeof useAgentConversation>;
