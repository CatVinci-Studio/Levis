import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentTurn } from "./types";

/// Multi-turn agent conversation state/logic backing the inline chat bar
/// (see InlineChatBar) against the `ai_agent_message` backend command -
/// pulled out on its own so any other agent surface added later can reuse
/// the same history bookkeeping instead of reimplementing it.
export function useAgentConversation(document: string, provider: string) {
  const [history, setHistory] = useState<AgentTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const newTurns = await invoke<AgentTurn[]>("ai_agent_message", {
        provider,
        document,
        history,
        message: trimmed,
      });
      setHistory((prev) => [...prev, ...newTurns]);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return { history, busy, error, send };
}
