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
import { PinIcon } from "../../ui/icons";
import { unlistenAll } from "../../utils/tauri-events";
// Every theme custom property (--editor-bg, --editor-text, --editor-border,
// ...) is declared on :root in App.css, which until now only App.tsx pulled
// in. This window doesn't render App, so without this import every var()
// below resolves to nothing and the whole window is unstyled.
import "../../App.css";
import "../AgentTurnView.css";
import "./inline-chat.css";
import "./chat-window.css";

/** How long a send waits for the editor to answer a context request before
 *  going out with the last pushed copy. Short: this is same-machine window
 *  IPC, and blocking a send on a window that has gone unresponsive would be
 *  worse than sending a slightly older document. */
const CONTEXT_REQUEST_TIMEOUT_MS = 400;

/**
 * The chat as its own OS window - and, deliberately, the CROSS-FILE surface.
 *
 * A real window rather than a webview-drawn panel, because the point of
 * detaching is to put it OUTSIDE the main window - which only the platform's
 * own window can do, along with native edge/corner resizing and multi-monitor
 * placement.
 *
 * The Agent's two surfaces divide by scope, not by size: the in-document
 * Quick Ask bar is about ONE file and keeps the snapshot it opened with,
 * while this window follows the user. Switch tabs or windows and its
 * document, title and selection follow; highlight a new passage and it
 * arrives here as a new selection chip. There is only ever one of these
 * windows per scope (see commands/chat_window.rs), which is what makes
 * "follows the user" coherent - two of them would fight over the same
 * editor.
 *
 * It renders the same ChatBody as the embedded popup and, like the popup,
 * owns no document state: proposals and accept/reject are forwarded to the
 * editor window (chat-bridge.ts), which stays the single place edits are
 * resolved and applied. Losing that would mean two implementations of the
 * anchor/apply logic drifting apart.
 */
export function ChatWindowApp() {
  const { t, settings, setSettings } = useSettings();
  const [handoff, setHandoff] = useState<ChatHandoff | null>(null);
  const [context, setContext] = useState<ChatContext | null>(null);
  const [statuses, setStatuses] = useState<Record<string, PendingStatus>>({});
  const [lost, setLost] = useState(false);
  // The editor currently being talked to, read inside callbacks that outlive
  // a render. Not fixed for the window's life: every context push re-points
  // it, which is how one window serves several documents (chat-bridge.ts).
  const editorLabel = useRef<string | null>(null);

  const agentModel = settings.agentModels[settings.aiProvider] || undefined;
  const conversation = useAgentConversation(
    context?.docPath ?? null,
    settings.agentWorkspaceRoot || null,
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

  // A send parked waiting for a fresh context (see refreshContext below).
  // At most one: `send` refuses to start while another is in flight.
  const contextWaiter = useRef<((context: ChatContext) => void) | null>(null);

  const applyContext = useCallback((incoming: ChatContext) => {
    // The push doubles as "this editor is the one talking now", so the reply
    // address moves with the document rather than being tracked separately
    // and drifting out of step with it.
    if (incoming.editorLabel) editorLabel.current = incoming.editorLabel;
    setContext(incoming);
    const waiter = contextWaiter.current;
    contextWaiter.current = null;
    waiter?.(incoming);
  }, []);

  // The editor pushes a fresh document/selection whenever either changes, so
  // the window shows the file the user is actually in and every new
  // highlight becomes a new selection chip.
  useEffect(() => {
    return unlistenAll(
      onWindowEvent<ChatContext>(EDITOR_TO_CHAT.context, applyContext),
      onWindowEvent<Record<string, PendingStatus>>(
        EDITOR_TO_CHAT.statuses,
        setStatuses,
      ),
    );
  }, [applyContext]);

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
    return unlistenAll(unlisten);
  }, [conversation.conversationId, conversation.history]);

  // Pin: a chat the user keeps beside their writing is worth nothing if it
  // disappears behind the editor the moment they click into the document.
  // The setting (not window-local state) so it survives closing the window.
  const pinned = settings.pinAgentWindow;
  useEffect(() => {
    void getCurrentWindow().setAlwaysOnTop(pinned);
  }, [pinned]);

  // The title says which document this is currently about - the one piece of
  // "which file am I talking to" visible when the window is on another
  // monitor with the editor out of sight.
  const docTitle = context?.docTitle;
  useEffect(() => {
    void getCurrentWindow().setTitle(
      docTitle ? `${t.chatWindowTitle} - ${docTitle}` : t.chatWindowTitle,
    );
  }, [docTitle, t.chatWindowTitle]);

  const send = useCallback((event: string, payload?: unknown) => {
    if (editorLabel.current) sendToWindow(editorLabel.current, event, payload);
  }, []);

  /** Every doc-scoped message says which file it was meant for: this window
   *  serves several, and the editor may have switched tabs since. */
  const docPath = context?.docPath ?? null;
  const sendScoped = useCallback(
    (event: string, payload: object) => send(event, { ...payload, docPath }),
    [send, docPath],
  );

  /** Asks the active editor for its document/selection as they read right
   *  now, and resolves with the answer. See ChatBody's `refreshContext`. */
  const refreshContext = useCallback(
    () =>
      new Promise<ChatContext | null>((resolve) => {
        if (!editorLabel.current) return resolve(null);
        const timer = window.setTimeout(() => {
          contextWaiter.current = null;
          resolve(null);
        }, CONTEXT_REQUEST_TIMEOUT_MS);
        contextWaiter.current = (incoming) => {
          window.clearTimeout(timer);
          resolve(incoming);
        };
        send(CHAT_TO_EDITOR.requestContext);
      }),
    [send],
  );

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
      {/* The window's top row, and the only chrome this view draws. It sits
          where the title bar would be (see detach_chat_window's overlay
          style), so it doubles as the drag handle - without one, a window
          with hidden title bar can't be moved. Content is right-aligned so
          it clears the traffic lights on macOS without a hardcoded
          platform-specific inset. */}
      <div className="chat-window-header" data-tauri-drag-region>
        <span className="chat-window-doc" title={context.docPath ?? undefined}>
          {context.docTitle}
        </span>
        <button
          type="button"
          className={`chat-window-pin ${pinned ? "chat-window-pin-on" : ""}`}
          aria-pressed={pinned}
          aria-label={t.chatWindowPin}
          title={pinned ? t.chatWindowUnpinHint : t.chatWindowPinHint}
          onClick={() => setSettings({ pinAgentWindow: !pinned })}
        >
          <PinIcon />
        </button>
      </div>
      <div className="chat-window-body">
        <ChatBody
          document={context.document}
          selectedText={context.selectedText}
          selectionMarkdown={context.selectionMarkdown}
          docPath={context.docPath}
          workspaceRoot={settings.agentWorkspaceRoot || null}
          conversation={conversation}
          labels={labels}
          proposalStatus={proposalStatus}
          pendingCount={pendingCount}
          fillHeight
          refreshContext={refreshContext}
          onProposals={(
            proposals: { callId: string; proposal: EditProposal }[],
          ) => sendScoped(CHAT_TO_EDITOR.proposals, { proposals })}
          onAcceptProposal={(callId) =>
            sendScoped(CHAT_TO_EDITOR.accept, { callId })
          }
          onRejectProposal={(callId) =>
            sendScoped(CHAT_TO_EDITOR.reject, { callId })
          }
          onAcceptAll={() => sendScoped(CHAT_TO_EDITOR.acceptAll, {})}
          onRejectAll={() => sendScoped(CHAT_TO_EDITOR.rejectAll, {})}
        />
      </div>
    </div>
  );
}
