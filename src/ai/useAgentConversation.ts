import { useEffect, useRef, useState } from "react";
import {
  conversationTitle,
  saveConversation,
  type ChatHistoryEntry,
} from "./chat-history";
import type { AgentTurn } from "./types";
import { ai, AI_CANCELLED, IpcError, type StreamEvent } from "../ipc";

/** What has streamed in so far for the in-flight exchange: completed
 *  intermediate turns (the user's own message, tool calls/results as they
 *  land) plus the assistant prose fragment currently being generated.
 *  Display-only - the resolved request's turn list is what enters
 *  `history`; this exists so the UI has something live to show first. */
export interface StreamingState {
  turns: AgentTurn[];
  text: string;
}

/** The (document, message) pair behind the last failed send - lets the
 *  caller offer a "retry" that resends without the user retyping. */
export interface RetryableSend {
  document: string;
  message: string;
}

/** A first-run lesson can return ordinary assistant prose or a realistic
 * sequence containing tool calls, without contacting an AI provider. */
export type MockAgentReply = (message: string) => string | AgentTurn[];

/// Multi-turn agent conversation state/logic backing the inline chat bar
/// (see ai/chat/InlineChat.tsx) against the `ai_agent_message` backend command -
/// pulled out on its own so any other agent surface added later can reuse
/// the same history bookkeeping instead of reimplementing it.
///
/// Lives above the chat bar itself (see MilkdownEditor) so a completed
/// exchange can be saved after the popup closes. A normal popup open calls
/// `reset` and starts fresh; only `restore`, reached from sidebar history,
/// resumes an earlier conversation. The document is passed per send, not
/// held here, so each message sees the document as it was when the bar was
/// opened.
export function useAgentConversation(
  docPath: string | null,
  provider: string,
  webSearch: boolean,
  model: string | undefined,
  /** When set, `send` never reaches the backend: after a short "thinking"
   *  pause the reply is this pre-written text. The onboarding tour runs the
   *  chat this way - first-run users have no AI account, and the tour must
   *  behave identically for everyone. Mocked exchanges are also NOT saved
   *  to the chat history (they aren't real conversations). */
  mockReply?: MockAgentReply | null,
  /** Raw stream events beyond what `streaming` state captures - the editor
   *  hooks propose_edit argument fragments here to grow the in-document
   *  preview while the model is still writing it. Read through a ref, so a
   *  re-render mid-request picks up the newest callback. */
  onStreamEvent?: (event: StreamEvent) => void,
) {
  const [conversationId, setConversationId] = useState<string>(() =>
    crypto.randomUUID(),
  );
  const [history, setHistory] = useState<AgentTurn[]>([]);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [busy, setBusy] = useState(false);
  const onStreamEventRef = useRef(onStreamEvent);
  onStreamEventRef.current = onStreamEvent;
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState<RetryableSend | null>(null);
  // The in-flight request's id, for stop() to cancel by - null when nothing
  // is running (or the running exchange is a mocked one, which has no
  // backend request to cancel).
  const requestIdRef = useRef<string | null>(null);
  // Incremented whenever a fresh popup replaces the current conversation.
  // A late response from the old popup must never leak into the new chat.
  const generationRef = useRef(0);

  // Once a scripted exchange has landed in `history`, the conversation is
  // tainted until reset - checking `mockReply` alone isn't enough, because
  // the tour ending flips it to null one render BEFORE the cleanup below
  // empties the history, and the save effect would fire in that gap.
  const mockTainted = useRef(!!mockReply);

  // Every exchange updates the conversation's saved copy, so past chats can
  // be reopened from the History list even across restarts.
  useEffect(() => {
    if (history.length === 0 || mockTainted.current) return;
    saveConversation({
      id: conversationId,
      docPath,
      title: conversationTitle(history),
      updatedAt: Date.now(),
      turns: history,
    });
  }, [history, conversationId, docPath]);

  // Leaving mock mode (the tour ended or was skipped): drop the scripted
  // exchange entirely - it must never ride along into a real conversation
  // or the saved history.
  const wasMock = useRef(!!mockReply);
  useEffect(() => {
    if (wasMock.current && !mockReply) reset();
    wasMock.current = !!mockReply;
  });

  /** Returns the newly arrived turns (undefined if the send was skipped or
   *  failed) - the caller's hook for reacting to what came back, e.g. the
   *  chat bar turning propose_edit tool calls into in-document previews. */
  async function send(
    document: string,
    message: string,
  ): Promise<AgentTurn[] | undefined> {
    const trimmed = message.trim();
    if (!trimmed || busy) return undefined;
    setBusy(true);
    setError(null);
    setRetryable(null);
    // The user's message shows immediately as a streamed turn - the real
    // one only enters `history` when the whole exchange resolves.
    setStreaming({ turns: [{ kind: "User", text: trimmed }], text: "" });
    const requestId = crypto.randomUUID();
    const generation = generationRef.current;
    requestIdRef.current = requestId;
    try {
      if (mockReply) mockTainted.current = true;
      const newTurns = mockReply
        ? await mockExchange(trimmed, mockReply(trimmed))
        : await ai.agentMessage({
            provider,
            document,
            docPath,
            history,
            message: trimmed,
            webSearch,
            model: model || null,
            requestId,
            onEvent: (event) => {
              if (generation !== generationRef.current) return;
              onStreamEventRef.current?.(event);
              if (event.type === "delta") {
                setStreaming((prev) => ({
                  turns: prev?.turns ?? [],
                  text: (prev?.text ?? "") + event.text,
                }));
              } else if (event.type === "turn") {
                // Interim prose that streamed before a tool call is dropped,
                // mirroring how the backend's step parsers prefer tool calls
                // over accompanying text - it never enters history either.
                setStreaming((prev) => ({
                  turns: [...(prev?.turns ?? []), event.turn],
                  text: "",
                }));
              }
            },
          });
      if (generation !== generationRef.current) return undefined;
      setHistory((prev) => [...prev, ...newTurns]);
      return newTurns;
    } catch (err) {
      if (generation !== generationRef.current) return undefined;
      // A user-initiated stop() isn't a failure - no error, and nothing to
      // retry (the message wasn't the problem).
      if (err instanceof IpcError && err.cause === AI_CANCELLED)
        return undefined;
      setError(String(err));
      setRetryable({ document, message: trimmed });
      return undefined;
    } finally {
      if (generation === generationRef.current) {
        setBusy(false);
        setStreaming(null);
        requestIdRef.current = null;
      }
    }
  }

  /** Cancels the in-flight request, if any - a no-op otherwise (already
   *  finished, or a mocked exchange with no backend request behind it). */
  function stop() {
    if (requestIdRef.current) void ai.cancelAgentMessage(requestIdRef.current);
  }

  /** Resends the last failed message unchanged. */
  function retry(): Promise<AgentTurn[] | undefined> {
    if (!retryable) return Promise.resolve(undefined);
    return send(retryable.document, retryable.message);
  }

  // Used when leaving mock mode and whenever the ordinary right-click /
  // shortcut entry point opens a fresh popup. History restoration bypasses
  // this and explicitly loads the selected conversation instead.
  function reset() {
    generationRef.current += 1;
    if (requestIdRef.current) void ai.cancelAgentMessage(requestIdRef.current);
    requestIdRef.current = null;
    setConversationId(crypto.randomUUID());
    setHistory([]);
    setStreaming(null);
    setBusy(false);
    setError(null);
    setRetryable(null);
    mockTainted.current = !!mockReply;
  }

  /** Restores a saved conversation as the live one - sending continues it. */
  function restore(entry: ChatHistoryEntry) {
    generationRef.current += 1;
    if (requestIdRef.current) void ai.cancelAgentMessage(requestIdRef.current);
    requestIdRef.current = null;
    setConversationId(entry.id);
    setHistory(entry.turns);
    setStreaming(null);
    setBusy(false);
    setError(null);
    setRetryable(null);
    mockTainted.current = !!mockReply;
  }

  return {
    // Exposed so a conversation can move between windows (detached chat)
    // without being re-saved under a new id each hop, which would leave one
    // exchange scattered across several sidebar history entries.
    conversationId,
    history,
    streaming,
    busy,
    error,
    retryable,
    send,
    stop,
    retry,
    reset,
    restore,
  };
}

export type AgentConversation = ReturnType<typeof useAgentConversation>;

/** A canned user/assistant exchange with a believable "thinking" pause. */
async function mockExchange(
  message: string,
  reply: string | AgentTurn[],
): Promise<AgentTurn[]> {
  await new Promise((resolve) => setTimeout(resolve, 1400));
  return [
    { kind: "User", text: message },
    ...(typeof reply === "string"
      ? ([{ kind: "Assistant", text: reply }] satisfies AgentTurn[])
      : reply),
  ];
}
