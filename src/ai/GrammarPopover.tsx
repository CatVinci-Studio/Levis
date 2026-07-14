import { useRef } from "react";
import { useViewportClamp } from "../utils/useViewportClamp";
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
  onApply: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function GrammarPopover({ info, applyLabel, onApply, onMouseEnter, onMouseLeave }: GrammarPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pos = useViewportClamp(rootRef, info.x, info.y);
  return (
    <div
      ref={rootRef}
      className="grammar-popover floating-surface"
      style={pos}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="grammar-popover-issue">{info.issue}</div>
      <div className="grammar-popover-suggestion">{info.suggestion}</div>
      <button className="grammar-popover-apply" onClick={onApply}>
        {applyLabel}
      </button>
    </div>
  );
}
