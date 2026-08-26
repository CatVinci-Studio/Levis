import type { Strings } from "../../i18n/strings";
import type { InlineChatLabels } from "./InlineChat";

/**
 * The chat's user-facing strings, assembled once here rather than inline at
 * each mount point - the embedded Quick Ask bar (MilkdownEditor) and the
 * detached window (ChatWindowApp) render the same components and so need
 * exactly the same set, and a second hand-written copy would go stale the
 * first time a label was added.
 */
export function chatLabels(t: Strings): InlineChatLabels {
  return {
    placeholder: t.agentInputPlaceholder,
    send: t.agentSend,
    stop: t.agentStop,
    retry: t.agentRetry,
    thinking: t.agentThinking,
    attachFile: t.agentAttachFile,
    attachmentTruncated: t.chatAttachmentTruncated,
    attachmentNoVision: t.chatAttachmentNoVision,
    selectedChars: t.chatSelectedChars,
    selectionChip: t.chatSelectionChip,
    proposalTitle: t.agentProposalTitle,
    proposalStatus: {
      streaming: t.proposalStatusStreaming,
      accepted: t.proposalStatusAccepted,
      rejected: t.proposalStatusRejected,
      invalid: t.proposalStatusInvalid,
    },
    proposalAccept: t.proposalAccept,
    proposalReject: t.proposalReject,
    proposalAcceptAll: t.proposalAcceptAll,
    proposalRejectAll: t.proposalRejectAll,
    proposalRelocate: t.proposalRelocate,
    diffCollapse: t.diffCollapse,
    diffShow: t.diffShow,
    pendingSummary: t.chatPendingSummary,
    pendingReveal: t.chatPendingReveal,
    quickAskPosition: t.quickAskPosition,
    quickAskPrevEdit: t.quickAskPrevEdit,
    quickAskNextEdit: t.quickAskNextEdit,
    quickAskAcceptAllCount: t.quickAskAcceptAllCount,
    quickAskRejectAllCount: t.quickAskRejectAllCount,
    dropSelection: t.chatDropSelection,
    relocateRequest: t.proposalRelocateRequest,
    expandConversation: t.chatExpandConversation,
    expandInline: t.chatExpandInline,
    collapseInline: t.chatCollapseInline,
    approvePlan: t.chatApprovePlan,
    executePlanRequest: t.chatExecutePlanRequest,
    modeAsk: t.agentModeAsk,
    modeEdit: t.agentModeEdit,
    modePlan: t.agentModePlan,
    webSearch: t.webSearchLabel,
    close: t.chatClose,
    detach: t.chatDetach,
    newConversation: t.chatNewConversation,
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
