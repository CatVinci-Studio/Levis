import { useRef } from "react";
import { ChatTabIcon, ChevronIcon } from "../ui/icons";
import { usePresenceProps } from "../ui/usePresence";
import "./ReviewBar.css";

export interface ReviewBarLabels {
  reviewBarLabel: string;
  reviewBarOpenChat: string;
  proposalAccept: string;
  proposalReject: string;
  proposalAcceptSome: string;
  proposalChangeCount: string;
  quickAskPosition: string;
  quickAskPrevEdit: string;
  quickAskNextEdit: string;
}

/**
 * The pending edits' controls, floating over the bottom of the document
 * while there are any: step through the changed sentences (‹ 1/3 ›), then
 * Accept what wasn't kept or Reject them all. The text itself carries a
 * ✓ / ✕ per sentence; this is the one place to finish - the AI panel's
 * card has the same buttons, the panel no longer has a bar of its own.
 *
 * On a phone it is the AI sheet's collapsed form: a bottom bar with big
 * buttons and a way back into the conversation.
 */
export function ReviewBar({
  labels,
  taken,
  total,
  position,
  stops,
  phone,
  onPrevious,
  onNext,
  onAccept,
  onReject,
  onOpenChat,
}: {
  labels: ReviewBarLabels;
  /** Sentences Accept would take, of all pending ones. */
  taken: number;
  total: number;
  /** The pointer (-1: not on a stop yet) and how many stops there are. */
  position: number;
  stops: number;
  phone: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onAccept: () => void;
  onReject: () => void;
  /** Phone: back to the conversation. */
  onOpenChat?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const presence = usePresenceProps(rootRef);
  const accept =
    taken < total
      ? labels.proposalAcceptSome
          .replace("{k}", String(taken))
          .replace("{n}", String(total))
      : labels.proposalAccept;
  const nav = stops > 1 && (
    <span className="review-bar-nav">
      <button
        type="button"
        aria-label={labels.quickAskPrevEdit}
        title={labels.quickAskPrevEdit}
        onClick={onPrevious}
      >
        <ChevronIcon className="review-bar-prev" />
      </button>
      <span className="review-bar-pos">
        {position < 0
          ? labels.proposalChangeCount.replace("{n}", String(stops))
          : labels.quickAskPosition
              .replace("{i}", String(position + 1))
              .replace("{n}", String(stops))}
      </span>
      <button
        type="button"
        aria-label={labels.quickAskNextEdit}
        title={labels.quickAskNextEdit}
        onClick={onNext}
      >
        <ChevronIcon className="review-bar-next" />
      </button>
    </span>
  );
  return (
    <div
      {...presence}
      className={`review-bar${phone ? " review-bar-phone" : ""}`}
      role="toolbar"
      aria-label={labels.reviewBarLabel}
    >
      <div className="review-bar-top">
        <span className="review-bar-label">{labels.reviewBarLabel}</span>
        {nav}
        {phone && onOpenChat && (
          <button
            type="button"
            className="review-bar-chat"
            aria-label={labels.reviewBarOpenChat}
            title={labels.reviewBarOpenChat}
            onClick={onOpenChat}
          >
            <ChatTabIcon />
          </button>
        )}
      </div>
      {!phone && <span className="review-bar-sep" aria-hidden="true" />}
      <div className="review-bar-actions">
        <button
          type="button"
          className="review-bar-button review-bar-accept"
          onClick={onAccept}
        >
          {accept}
        </button>
        <button type="button" className="review-bar-button" onClick={onReject}>
          {labels.proposalReject}
        </button>
      </div>
    </div>
  );
}
