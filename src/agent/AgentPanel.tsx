import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../settings/SettingsContext";
import type { AgentTurn } from "./types";
import "./AgentPanel.css";

interface AgentPanelProps {
  document: string;
}

export function AgentPanel({ document }: AgentPanelProps) {
  const { settings, t } = useSettings();
  const [history, setHistory] = useState<AgentTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const newTurns = await invoke<AgentTurn[]>("ai_agent_message", {
        provider: settings.aiProvider,
        document,
        history,
        message,
      });
      setHistory((prev) => [...prev, ...newTurns]);
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="agent-panel">
      <div className="agent-messages" ref={listRef}>
        {history.length === 0 && <div className="agent-empty-hint">{t.agentEmptyHint}</div>}
        {history.map((turn, i) => (
          <AgentTurnView key={i} turn={turn} />
        ))}
        {busy && <div className="agent-thinking">{t.agentThinking}</div>}
        {error && <div className="agent-error">{error}</div>}
      </div>
      <div className="agent-input-row">
        <textarea
          className="agent-input"
          placeholder={t.agentInputPlaceholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
        />
        <button className="text-button agent-send-button" onClick={send} disabled={busy || !input.trim()}>
          {t.agentSend}
        </button>
      </div>
    </div>
  );
}

function AgentTurnView({ turn }: { turn: AgentTurn }) {
  switch (turn.kind) {
    case "User":
      return <div className="agent-message agent-message-user">{turn.text}</div>;
    case "Assistant":
      return <div className="agent-message agent-message-assistant">{turn.text}</div>;
    case "ToolCall":
      return <div className="agent-tool-line">🔍 {turn.name}</div>;
    case "ToolResult":
      return (
        <details className="agent-tool-result">
          <summary>tool result</summary>
          <pre>{turn.output}</pre>
        </details>
      );
    default:
      return null;
  }
}
