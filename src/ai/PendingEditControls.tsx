import { useEffect, useRef, useState } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import { useViewportClamp } from "../utils/useViewportClamp";
import type { PendingPreview } from "./pending-edit-plugin";
import type { EditorRunner } from "../editor/useEditorRunner";
import "./PendingEditControls.css";

export interface PendingEditLabels {
  accept: string;
  reject: string;
  acceptAll: string;
  rejectAll: string;
  /** "{i}"/"{n}" placeholders - which preview of how many is focused. */
  ofCount: string;
}

interface PendingEditControlsProps {
  run: EditorRunner;
  previews: PendingPreview[];
  labels: PendingEditLabels;
  onAccept: (callId: string) => void;
  onReject: (callId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

/**
 * Floating ✓/✗ controls for the pending edit(s) currently decorated in the
 * document - a plain React overlay (position: fixed), not a widget
 * decoration, so it can't trigger the WKWebView caret-paint bug interactive
 * widgets near the caret have caused before (see project notes). Anchored
 * under the focused preview via coordsAtPos; cycling (‹›) only moves which
 * preview is focused here - every pending preview stays decorated in the
 * document at once, this just picks which one the buttons act on.
 */
export function PendingEditControls({
  run,
  previews,
  labels,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
}: PendingEditControlsProps) {
  const [index, setIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const clampedIndex = Math.min(index, Math.max(0, previews.length - 1));
  const focused = previews[clampedIndex];

  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!focused) return;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      try {
        const coords = view.coordsAtPos(focused.to);
        setAnchor({ x: coords.left, y: coords.bottom + 6 });
      } catch {
        // Position no longer valid this tick (mid-remap) - keep the last
        // anchor rather than throw; the next preview/doc update retries.
      }
    });
  }, [run, focused]);

  const pos = useViewportClamp(rootRef, anchor.x, anchor.y);

  if (!focused) return null;

  return (
    <div
      ref={rootRef}
      className="pending-edit-controls floating-surface"
      style={pos}
    >
      {previews.length > 1 && (
        <div className="pending-edit-nav">
          <button
            type="button"
            className="pending-edit-nav-btn"
            onClick={() =>
              setIndex((clampedIndex - 1 + previews.length) % previews.length)
            }
          >
            ‹
          </button>
          <span className="pending-edit-count">
            {labels.ofCount
              .replace("{i}", String(clampedIndex + 1))
              .replace("{n}", String(previews.length))}
          </span>
          <button
            type="button"
            className="pending-edit-nav-btn"
            onClick={() => setIndex((clampedIndex + 1) % previews.length)}
          >
            ›
          </button>
        </div>
      )}
      <div className="pending-edit-actions">
        <button
          type="button"
          className="pending-edit-action pending-edit-accept"
          onClick={() => onAccept(focused.callId)}
        >
          ✓ {labels.accept}
        </button>
        <button
          type="button"
          className="pending-edit-action pending-edit-reject"
          onClick={() => onReject(focused.callId)}
        >
          ✗ {labels.reject}
        </button>
      </div>
      {previews.length > 1 && (
        <div className="pending-edit-actions">
          <button
            type="button"
            className="pending-edit-action"
            onClick={onAcceptAll}
          >
            {labels.acceptAll}
          </button>
          <button
            type="button"
            className="pending-edit-action"
            onClick={onRejectAll}
          >
            {labels.rejectAll}
          </button>
        </div>
      )}
    </div>
  );
}
