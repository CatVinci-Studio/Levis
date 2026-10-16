import { useEffect, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { PendingEdits } from "./useEditorProposals";
import type { AgentConversation } from "../ai/chat/useAgentConversation";
import type { useInlineChat } from "../ai/chat/quick-ask/useInlineChat";
import { setQuickAskWidget } from "../ai/chat/quick-ask/quick-ask-widget-plugin";
import { keepClearOfDock } from "../ai/chat/quick-ask/quick-ask-dock";
import type { AgentPanelFrame } from "../ai/chat/panel/agent-panel";
import { canDetachChat } from "../platform/capabilities";
import type { Settings } from "../settings/SettingsContext";

/** Opening, closing and handing on Quick Ask, from every entry point (the
 *  shortcut, the context menu, its own buttons). */
export function useQuickAskControls({
  run,
  inlineChat,
  pendingEdits,
  conversation,
  quickConversation,
  quickAskEl,
  phone,
  isActive,
  settings,
  agentPanel,
  handleDetachChat,
}: {
  run: EditorRunner;
  inlineChat: ReturnType<typeof useInlineChat>;
  pendingEdits: PendingEdits;
  conversation: AgentConversation;
  quickConversation: AgentConversation;
  quickAskEl: HTMLElement | null;
  phone: boolean;
  isActive: boolean;
  settings: Settings;
  agentPanel: AgentPanelFrame;
  handleDetachChat: () => void;
}) {
  // What Ask AI means, from every entry point: Quick Ask opens at the caret,
  // whatever the panel or a detached window is doing - it has its own
  // conversation, so there is nothing to race. The shortcut additionally
  // closes a Quick Ask whose composer already has focus, so pressing it
  // twice is "open, then put away".
  // Closing, and starting a new conversation, are guarded: with edits still
  // undecided the panel asks first (CloseConfirmBar), from every entry point.
  const [chatGuard, setChatGuard] = useState<"close" | "new" | null>(null);

  // The question is moot once the panel is gone (detached, say) or its
  // edits are all decided some other way - in the document, for instance.
  const decidableCount = pendingEdits.decidable.length;
  useEffect(() => {
    if (!inlineChat.visible || decidableCount === 0) setChatGuard(null);
  }, [inlineChat.visible, decidableCount]);

  // Where the Quick Ask panel renders: the zone widget in the document, or
  // on a phone the page itself, docked - for the active tab only, since
  // the page is shared by every tab's editor.
  const quickAskHost = phone ? (isActive ? document.body : null) : quickAskEl;
  const chatComposer = () =>
    quickAskHost?.querySelector<HTMLTextAreaElement>(".inline-chat textarea") ??
    null;

  /** Docked Quick Ask: keeps what it is about - the edit under review, the
   *  first one proposed, else the passage it was opened on - above the
   *  panel as the panel opens and grows. */
  function keepQuickAskTargetInView(first: boolean) {
    const info = inlineChat.chatInfo;
    const target =
      (pendingEdits.focusedPreview ?? pendingEdits.decidable[0])?.from ??
      info?.range?.from ??
      info?.anchor;
    if (target === undefined) return;
    run((ctx) => keepClearOfDock(ctx.get(editorViewCtx), target, first));
  }

  function focusEditor() {
    run((ctx) => ctx.get(editorViewCtx).focus());
  }

  function performChatAction(action: "close" | "new") {
    setChatGuard(null);
    if (action === "close") {
      // Closing while a reply is still running stops it: otherwise previews
      // kept appearing in the document with no panel left to decide them.
      if (quickConversation.busy) quickConversation.stop();
      inlineChat.close();
      focusEditor();
    } else {
      quickConversation.reset();
      inlineChat.close();
      inlineChat.open();
    }
  }

  function requestChatAction(action: "close" | "new") {
    if (pendingEdits.decidable.length > 0) setChatGuard(action);
    else performChatAction(action);
  }

  function openAgentConversation() {
    const wasVisible = inlineChat.visible;
    // A fresh Quick Ask is a fresh question; an open one keeps its exchange.
    if (!wasVisible && !quickConversation.busy) quickConversation.reset();
    const moveTo = inlineChat.open();
    if (moveTo !== null && !phone) {
      run((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(setQuickAskWidget(view.state.tr, moveTo));
      });
    }
    if (wasVisible) chatComposer()?.focus();
  }

  function startNewAgentConversation() {
    requestChatAction("new");
  }

  function toggleAgentConversation() {
    const composer = chatComposer();
    if (inlineChat.visible && composer && document.activeElement === composer) {
      requestChatAction("close");
    } else {
      openAgentConversation();
    }
  }

  // Quick Ask's "continue in the panel": its exchange becomes the full
  // conversation - in the docked panel, or the detached window when the
  // user prefers it there (Settings > Textus AI > Advanced) - and from then
  // on is saved to History like any other. The panel's previous
  // conversation is already in History. Not while either side is
  // mid-reply: the turns would be incomplete.
  function expandQuickAsk() {
    if (quickConversation.busy || conversation.busy) return;
    if (quickConversation.history.length > 0) {
      conversation.restore(crypto.randomUUID(), quickConversation.history);
    }
    quickConversation.reset();
    inlineChat.close();
    if (settings.agentExpandToWindow && canDetachChat) {
      // After the restore has rendered, so the window gets the new turns.
      requestAnimationFrame(() => handleDetachChat());
      return;
    }
    agentPanel.setOpen(true);
  }

  return {
    chatGuard,
    setChatGuard,
    quickAskHost,
    chatComposer,
    keepQuickAskTargetInView,
    performChatAction,
    requestChatAction,
    openAgentConversation,
    startNewAgentConversation,
    toggleAgentConversation,
    expandQuickAsk,
  };
}
