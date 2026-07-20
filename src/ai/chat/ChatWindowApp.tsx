import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettings } from "../../settings/SettingsContext";
import { useAgentConversation } from "../useAgentConversation";
import type { PendingStatus } from "../usePendingEdits";
import type { EditProposal } from "../types";
import { ChatBody } from "./ChatBody";
import { chatLabels } from "./chat-labels";
import {
  CHAT_TO_EDITOR,
  EDITOR_TO_CHAT,
  onWindowEvent,
  sendToWindow,
  type ChatContext,
  type ChatHandoff,
} from "./chat-bridge";
import { windowIpc } from "../../ipc";
// Every theme custom property (--editor-bg, --editor-text, --editor-border,
// ...) is declared on :root in App.css, which until now only App.tsx pulled
// in. This window doesn't render App, so without this import every var()
// below resolves to nothing and the whole window is unstyled.
import "../../App.css";
import "../AgentTurnView.css";
import "./inline-chat.css";
import "./chat-window.css";

/**
 * The chat as its own OS window.
 *
 * A real window rather than a webview-drawn panel, because the point of
 * detaching is to put it OUTSIDE the main window - which only the platform's
 * own window can do, along with native edge/corner resizing and multi-monitor
 * placement.
 *
 * It renders the same ChatBody as the embedded popup and, like the popup,
 * owns no document state: proposals and accept/reject are forwarded to the
 * editor window (chat-bridge.ts), which stays the single place edits are
 * resolved and applied. Losing that would mean two implementations of the
 * anchor/apply logic drifting apart.
 */
export function ChatWindowApp() {
  const { t, settings } = useSettings();
  const [handoff, setHandoff] = useState<ChatHandoff | null>(null);
  const [context, setContext] = useState<ChatContext | null>(null);
  const [statuses, setStatuses] = useState<Record<string, PendingStatus>>({});
  const [lost, setLost] = useState(false);
  // The editor's label, read inside callbacks that outlive a render.
  const editorLabel = useRef<string | null>(null);

  const agentModel = settings.agentModels[settings.aiProvider] || undefined;
  const conversation = useAgentConversation(
    context?.docPath ?? null,
    settings.aiProvider,
    settings.enableWebSearch,
    agentModel,
    null,
  );
  const restored = useRef(false);

  // Claim the handoff this window was created for. Destructive and
  // once-only, same contract as takeDetachedTab - the module-level guard
  // exists because StrictMode double-runs mount effects in dev.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void (async () => {
      const claimed = await windowIpc.takeChatHandoff();
      if (!claimed) {
        // Nothing to carry on from - the editor went away between creating
        // this window and it mounting.
        setLost(true);
        return;
      }
      editorLabel.current = claimed.editorLabel;
      setHandoff(claimed);
      setContext(claimed.state.context);
      setStatuses(claimed.state.statuses);
      if (claimed.state.turns.length > 0) {
        conversation.restore({
          id: claimed.state.conversationId,
          docPath: claimed.state.context.docPath,
          title: "",
          updatedAt: Date.now(),
          turns: claimed.state.turns,
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The editor pushes a fresh document/selection whenever either changes, so
  // a send always goes out against what the document says NOW rather than
  // what it said when the window was detached.
  useEffect(() => {
    const unlistenContext = onWindowEvent<ChatContext>(
      EDITOR_TO_CHAT.context,
      setContext,
    );
    const unlistenStatuses = onWindowEvent<Record<string, PendingStatus>>(
      EDITOR_TO_CHAT.statuses,
      setStatuses,
    );
    return () => {
      void unlistenContext.then((f) => f());
      void unlistenStatuses.then((f) => f());
    };
  }, []);

  // Closing the window hands the conversation back so the editor can re-embed
  // the panel instead of silently losing the exchange.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(() => {
      if (editorLabel.current)
        sendToWindow(editorLabel.current, CHAT_TO_EDITOR.reembed, {
          conversationId: conversation.conversationId,
          turns: conversation.history,
        });
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, [conversation.conversationId, conversation.history]);

  const send = useCallback((event: string, payload?: unknown) => {
    if (editorLabel.current) sendToWindow(editorLabel.current, event, payload);
  }, []);

  const proposalStatus = useCallback(
    (callId: string): PendingStatus => statuses[callId] ?? "pending",
    [statuses],
  );
  const pendingCount = useMemo(
    () => Object.values(statuses).filter((s) => s === "pending").length,
    [statuses],
  );

  const labels = useMemo(() => chatLabels(t), [t]);

  if (lost) return <div className="chat-window-lost">{t.chatWindowLost}</div>;
  if (!handoff || !context)
    return <div className="chat-window-loading">{t.agentThinking}</div>;

  return (
    <div className="chat-window">
      <div className="chat-window-body">
        <ChatBody
          document={context.document}
          selectedText={context.selectedText}
          selectionMarkdown={context.selectionMarkdown}
          docPath={context.docPath}
          conversation={conversation}
          labels={labels}
          proposalStatus={proposalStatus}
          pendingCount={pendingCount}
          fillHeight
          onProposals={(
            proposals: { callId: string; proposal: EditProposal }[],
          ) => send(CHAT_TO_EDITOR.proposals, { proposals })}
          onAcceptProposal={(callId) => send(CHAT_TO_EDITOR.accept, { callId })}
          onRejectProposal={(callId) => send(CHAT_TO_EDITOR.reject, { callId })}
          onAcceptAll={() => send(CHAT_TO_EDITOR.acceptAll)}
          onRejectAll={() => send(CHAT_TO_EDITOR.rejectAll)}
        />
      </div>
    </div>
  );
}
