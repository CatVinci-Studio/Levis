import { useRef } from "react";
import { useViewportClamp } from "../utils/useViewportClamp";
import "./CoachMark.css";

interface CoachMarkProps {
  x: number;
  y: number;
  text: string;
  gotItLabel: string;
  skipAllLabel: string;
  onDismiss: () => void;
  onSkipAll: () => void;
}

/**
 * A small anchored bubble - same positioning approach as GrammarPopover
 * (useViewportClamp off an {x, y} the caller computed, usually via
 * view.coordsAtPos). z-index sits under the chat popup (220) so it can
 * never cover one, but over ordinary editor chrome.
 */
export function CoachMark({
  x,
  y,
  text,
  gotItLabel,
  skipAllLabel,
  onDismiss,
  onSkipAll,
}: CoachMarkProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pos = useViewportClamp(rootRef, x, y);
  return (
    <div ref={rootRef} className="coach-mark floating-surface" style={pos}>
      <div className="coach-mark-text">{text}</div>
      <div className="coach-mark-actions">
        <button type="button" className="coach-mark-skip" onClick={onSkipAll}>
          {skipAllLabel}
        </button>
        <button type="button" className="coach-mark-got-it" onClick={onDismiss}>
          {gotItLabel}
        </button>
      </div>
    </div>
  );
}
