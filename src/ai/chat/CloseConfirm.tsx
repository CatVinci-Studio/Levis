import { useState } from "react";

export interface CloseConfirmLabels {
  /** Close prompt while edits are pending; "{n}" is how many. */
  closeConfirm: string;
  closeConfirmAccept: string;
  closeConfirmReject: string;
  closeConfirmCancel: string;
}

/**
 * The close-with-pending-edits guard shared by every chat surface (Quick
 * Ask popup and docked sidebar): closing while proposals are undecided asks
 * first, rather than leaving previews decorated in the document with the
 * surface that explains them gone.
 */
export function useCloseConfirm(pendingCount: number, onClose: () => void) {
  const [confirming, setConfirming] = useState(false);
  function requestClose() {
    if (pendingCount > 0) {
      setConfirming(true);
      return;
    }
    onClose();
  }
  return { confirming, cancel: () => setConfirming(false), requestClose };
}

/** The confirmation bar itself - rendered into ChatBody's `footer` slot. */
export function CloseConfirmBar({
  labels,
  pendingCount,
  onAcceptAll,
  onRejectAll,
  onClose,
  onCancel,
}: {
  labels: CloseConfirmLabels;
  pendingCount: number;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="inline-chat-confirm">
      <span className="inline-chat-confirm-message">
        {labels.closeConfirm.replace("{n}", String(pendingCount))}
      </span>
      <div className="inline-chat-confirm-actions">
        <button
          className="inline-chat-action inline-chat-action-primary"
          onClick={() => {
            onAcceptAll();
            onClose();
          }}
        >
          {labels.closeConfirmAccept}
        </button>
        <button
          className="inline-chat-action"
          onClick={() => {
            onRejectAll();
            onClose();
          }}
        >
          {labels.closeConfirmReject}
        </button>
        <button className="inline-chat-action" onClick={onCancel}>
          {labels.closeConfirmCancel}
        </button>
      </div>
    </div>
  );
}
