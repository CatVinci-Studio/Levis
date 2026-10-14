import { useRef, type CSSProperties } from "react";
import { useViewportClamp } from "../utils/useViewportClamp";
import { usePresenceProps } from "../ui/usePresence";
import "./GrammarPopover.css";

export interface GrammarPopoverInfo {
  x: number;
  y: number;
  from: number;
  to: number;
  issue: string;
  suggestion: string;
  /** Exact text the range must still contain for Apply to act. */
  original?: string;
}

interface GrammarPopoverProps {
  info: GrammarPopoverInfo;
  applyLabel: string;
  ignoreLabel: string;
  /** Why the last Apply click did nothing (stale text) - shown in place of the button. */
  error: string | null;
  onApply: () => void;
  onIgnore: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function GrammarPopover({
  info,
  applyLabel,
  ignoreLabel,
  error,
  onApply,
  onIgnore,
  onMouseEnter,
  onMouseLeave,
}: GrammarPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pos = useViewportClamp(rootRef, info.x, info.y);
  const presence = usePresenceProps(rootRef);
  // It grows out of the underline it explains: from its top edge, or its
  // bottom one when the window's edge pushed it up over the line.
  const origin = {
    "--transform-origin": `${Math.max(0, info.x - pos.left)}px ${pos.top < info.y - 0.5 ? "100%" : "0"}`,
  } as CSSProperties;
  return (
    <div
      {...presence}
      className="grammar-popover floating-surface"
      style={{ ...pos, ...origin }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="grammar-popover-issue">{info.issue}</div>
      <div className="grammar-popover-suggestion">{info.suggestion}</div>
      {error ? (
        <div className="grammar-popover-error">{error}</div>
      ) : (
        <div className="grammar-popover-actions">
          <button
            className="grammar-popover-apply"
            onClick={onApply}
            title="Alt+Enter"
          >
            {applyLabel}
          </button>
          <button className="grammar-popover-ignore" onClick={onIgnore}>
            {ignoreLabel}
          </button>
        </div>
      )}
    </div>
  );
}
