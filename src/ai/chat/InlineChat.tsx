import { useRef } from "react";
import { useViewportClamp } from "../../utils/useViewportClamp";
import type { EditorRunner } from "../../editor/useEditorRunner";
import type { InlineChatInfo } from "../useInlineChat";
import { ChatSurfaceBody, type ChatSurfaceProps } from "./ChatSurfaceBody";
import { useCloseConfirm } from "./CloseConfirm";
import { useAnchoredPosition } from "./useAnchoredPosition";
import "../AgentTurnView.css";
import "./inline-chat.css";

interface InlineChatProps extends ChatSurfaceProps {
  /** Drives the popup's position: it follows the document position it was
   *  opened on instead of staying at the coordinates captured then. */
  run: EditorRunner;
  /** The full context captured when the bar opened. */
  chatInfo: InlineChatInfo;
  /** Expands this same conversation into the docked sidebar - the explicit,
   *  user-initiated escalation path; nothing moves there on its own. */
  onOpenSidebar: () => void;
}

/// QUICK ASK - the lightest of the chat's three surfaces (this popup, the
/// docked sidebar, the detached window), modeled on the inline "Cmd+K"
/// assistant popups in editors like VS Code.
///
/// It opens beside the caret as little more than an input bar; replies show
/// compactly right here (only the latest exchange, tightly capped) so
/// nothing jumps elsewhere on its own, and edit proposals land in the
/// document as previews as always. Wanting the full conversation is an
/// explicit step: the header's expand button opens the SAME conversation in
/// the docked sidebar - two renderings of one state, so the switch is
/// seamless.
///
/// Placement is automatic: it follows the caret, flips to whichever side of
/// the line has room, and stays inside the viewport. Deliberately NOT
/// draggable or resizable - arranging the chat is what the sidebar and the
/// detached window are for.
///
/// This file is only the popup's CHROME: placement, the header, and the
/// close confirmation trigger. The chat itself is ChatSurfaceBody, shared
/// verbatim with the sidebar so the surfaces can't drift.
export function InlineChat({
  run,
  chatInfo,
  onOpenSidebar,
  ...surface
}: InlineChatProps) {
  // Deliberately NOT closed by clicking outside: the panel is a working
  // surface the user reads next to the document, and an outside click is
  // usually them going to look at that document. Closing is explicit.
  const rootRef = useRef<HTMLDivElement>(null);
  const anchor = useAnchoredPosition(run, chatInfo.anchorPos);
  // grow "up" when placed above the line: the composer's screen position
  // stays put and the history grows away from the text, instead of the panel
  // growing over the document as the conversation lengthens.
  const pos = useViewportClamp(
    rootRef,
    anchor?.x ?? chatInfo.x,
    anchor?.y ?? chatInfo.y,
    { grow: anchor?.side === "above" ? "up" : "down" },
  );

  const confirm = useCloseConfirm(surface.pendingCount, surface.onClose);

  return (
    <div ref={rootRef} className="inline-chat" style={pos}>
      <div className="inline-chat-shell floating-surface">
        <div className="inline-chat-header">
          <div className="inline-chat-header-actions">
            <button
              type="button"
              className="inline-chat-header-button"
              aria-label={surface.labels.openSidebar}
              title={surface.labels.openSidebar}
              onClick={onOpenSidebar}
            >
              ⇥
            </button>
            <button
              type="button"
              className="inline-chat-header-button inline-chat-close"
              aria-label={surface.labels.close}
              title={surface.labels.close}
              onClick={confirm.requestClose}
            >
              ✕
            </button>
          </div>
        </div>
        <ChatSurfaceBody surface="quick" confirm={confirm} {...surface} />
      </div>
    </div>
  );
}
