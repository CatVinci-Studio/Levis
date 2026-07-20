import type { Strings } from "../../i18n/strings";
import type { InlineChatLabels } from "./InlineChat";

/**
 * The chat's user-facing strings, assembled once here rather than inline at
 * each mount point - the embedded popup (MilkdownEditor) and the detached
 * window (ChatWindowApp) render the same components and so need exactly the
 * same set, and a second hand-written copy would go stale the first time a
 * label was added.
 */
export function chatLabels(t: Strings): InlineChatLabels {
  return {
    placeholder: t.agentInputPlaceholder,
    send: t.agentSend,
    stop: t.agentStop,
    retry: t.agentRetry,
    thinking: t.agentThinking,
    attachFile: t.agentAttachFile,
    selectedChars: t.chatSelectedChars,
    selectionChip: t.chatSelectionChip,
    proposalTitle: t.agentProposalTitle,
    proposalStatus: {
      accepted: t.proposalStatusAccepted,
      rejected: t.proposalStatusRejected,
      invalid: t.proposalStatusInvalid,
    },
    proposalAccept: t.proposalAccept,
    proposalReject: t.proposalReject,
    proposalAcceptAll: t.proposalAcceptAll,
    proposalRejectAll: t.proposalRejectAll,
    proposalRelocate: t.proposalRelocate,
    diffExpand: t.diffExpand,
    diffCollapse: t.diffCollapse,
    pendingSummary: t.chatPendingSummary,
    pendingReveal: t.chatPendingReveal,
    dropSelection: t.chatDropSelection,
    relocateRequest: t.proposalRelocateRequest,
    close: t.chatClose,
    detach: t.chatDetach,
    closeConfirm: t.chatCloseConfirm,
    closeConfirmAccept: t.chatCloseConfirmAccept,
    closeConfirmReject: t.chatCloseConfirmReject,
    closeConfirmCancel: t.chatCloseConfirmCancel,
    actionNames: {
      replace: t.agentActionReplace,
      replace_selection: t.agentActionReplaceSelection,
      insert_before: t.agentActionInsertBefore,
      insert_after: t.agentActionInsertAfter,
      delete: t.agentActionDelete,
      append: t.agentActionAppend,
    },
  };
}
