import { useState } from "react";
import { ChevronIcon } from "../../sidebar/icons";
import { useCloseOnOutsideClick } from "../../utils/useCloseOnOutsideClick";

export interface QuickAskPendingBarLabels {
  proposalAccept: string;
  proposalReject: string;
  /** "{i} / {n}" position indicator between the nav arrows. */
  quickAskPosition: string;
  quickAskPrevEdit: string;
  quickAskNextEdit: string;
  /** "{n}" is the total about to be accepted/rejected. */
  quickAskAcceptAllCount: string;
  quickAskRejectAllCount: string;
}

interface QuickAskPendingBarProps {
  /** How many edits are currently decidable (streaming ones excluded - see
   *  usePendingEdits.decidable). Nothing renders when this is 0. */
  total: number;
  /** 0-based position of the currently focused edit within the navigable
   *  set, or -1 if none is focused yet. */
  focusIndex: number;
  onFocusNext: () => void;
  onFocusPrevious: () => void;
  onAcceptFocused: () => void;
  onRejectFocused: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  labels: QuickAskPendingBarLabels;
}

/**
 * Quick Ask's review-one-at-a-time bar - the ONE control surface for edits
 * in this surface (no proposal cards render alongside it here, unlike the
 * detached window). Accept/Reject act on whichever edit the "i / n"
 * indicator currently points at; each one's small ▾ opens a single-item
 * menu for the bulk action ("Accept all (N)" / "Reject all (N)").
 */
export function QuickAskPendingBar({
  total,
  focusIndex,
  onFocusNext,
  onFocusPrevious,
  onAcceptFocused,
  onRejectFocused,
  onAcceptAll,
  onRejectAll,
  labels,
}: QuickAskPendingBarProps) {
  if (total === 0) return null;

  return (
    <div className="quick-ask-pending-bar">
      {total > 1 && (
        <div className="quick-ask-pending-nav">
          <button
            type="button"
            className="quick-ask-pending-nav-button"
            aria-label={labels.quickAskPrevEdit}
            title={labels.quickAskPrevEdit}
            onClick={onFocusPrevious}
          >
            ‹
          </button>
          <span className="quick-ask-pending-position">
            {labels.quickAskPosition
              .replace("{i}", String(focusIndex + 1))
              .replace("{n}", String(total))}
          </span>
          <button
            type="button"
            className="quick-ask-pending-nav-button"
            aria-label={labels.quickAskNextEdit}
            title={labels.quickAskNextEdit}
            onClick={onFocusNext}
          >
            ›
          </button>
        </div>
      )}
      <div className="quick-ask-pending-actions">
        <SplitButton
          label={labels.proposalAccept}
          menuLabel={labels.quickAskAcceptAllCount.replace(
            "{n}",
            String(total),
          )}
          onClick={onAcceptFocused}
          onMenuClick={onAcceptAll}
          primary
        />
        <SplitButton
          label={labels.proposalReject}
          menuLabel={labels.quickAskRejectAllCount.replace(
            "{n}",
            String(total),
          )}
          onClick={onRejectFocused}
          onMenuClick={onRejectAll}
        />
      </div>
    </div>
  );
}

/** A primary action button with a chevron that opens a single-item menu for
 *  the bulk variant of the same action ("Accept" -> chevron -> "Accept all
 *  (N)"). Generic enough to serve both Accept and Reject without knowing
 *  which one it is. */
function SplitButton({
  label,
  menuLabel,
  onClick,
  onMenuClick,
  primary,
}: {
  label: string;
  menuLabel: string;
  onClick: () => void;
  onMenuClick: () => void;
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useCloseOnOutsideClick<HTMLDivElement>(() => setOpen(false));

  return (
    <div className="quick-ask-split-button" ref={ref}>
      <button
        type="button"
        className={`inline-chat-action${primary ? " inline-chat-action-primary" : ""} quick-ask-split-main`}
        onClick={onClick}
      >
        {label}
      </button>
      <button
        type="button"
        className={`inline-chat-action${primary ? " inline-chat-action-primary" : ""} quick-ask-split-chevron`}
        aria-label={menuLabel}
        onClick={() => setOpen((prev) => !prev)}
      >
        <ChevronIcon className="quick-ask-split-chevron-icon" />
      </button>
      {open && (
        <div className="quick-ask-split-menu floating-surface">
          <button
            type="button"
            className="quick-ask-split-menu-item"
            onClick={() => {
              setOpen(false);
              onMenuClick();
            }}
          >
            {menuLabel}
          </button>
        </div>
      )}
    </div>
  );
}
