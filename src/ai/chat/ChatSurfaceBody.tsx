import type { AgentConversation } from "../useAgentConversation";
import type { PendingStatus } from "../usePendingEdits";
import type { EditProposal } from "../types";
import { ChatBody, type ChatBodyLabels } from "./ChatBody";
import {
  CloseConfirmBar,
  useCloseConfirm,
  type CloseConfirmLabels,
} from "./CloseConfirm";

/** The full label bag every chat surface renders from - assembled once in
 *  chat-labels.ts for the popup, the sidebar, and the detached window. */
export interface ChatSurfaceLabels extends ChatBodyLabels, CloseConfirmLabels {
  /** Accessible name / tooltip of a header's close button. */
  close: string;
  /** Accessible name / tooltip of the pop-out-to-OS-window button. */
  detach: string;
  /** Accessible name / tooltip of Quick Ask's expand-to-sidebar button. */
  openSidebar: string;
  /** The docked sidebar's header title. */
  sidebarTitle: string;
}

/** Everything a surface forwards into the shared body - one prop bag, so
 *  the Quick Ask popup and the docked sidebar can't drift a prop apart. */
export interface ChatSurfaceProps {
  document: string;
  selectedText: string | null;
  selectionMarkdown: string | null;
  docPath: string | null;
  conversation: AgentConversation;
  tutorialMock?: boolean;
  labels: ChatSurfaceLabels;
  onProposals: (
    proposals: { callId: string; proposal: EditProposal }[],
  ) => void;
  proposalStatus: (callId: string) => PendingStatus;
  onAcceptProposal: (callId: string) => void;
  onRejectProposal: (callId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  pendingCount: number;
  onRevealPending: () => void;
  onClose: () => void;
}

/**
 * The shared inner half of every IN-APP chat surface: ChatBody plus the
 * close-with-pending-edits confirmation, wired identically whichever chrome
 * (Quick Ask popup, docked sidebar) wraps it. A surface supplies only its
 * placement, its header, and the `confirm` it also feeds its own close
 * button - everything else lives here exactly once.
 */
export function ChatSurfaceBody({
  surface,
  confirm,
  ...props
}: ChatSurfaceProps & {
  surface: "quick" | "dock";
  confirm: ReturnType<typeof useCloseConfirm>;
}) {
  return (
    <ChatBody
      document={props.document}
      selectedText={props.selectedText}
      selectionMarkdown={props.selectionMarkdown}
      docPath={props.docPath}
      conversation={props.conversation}
      tutorialMock={props.tutorialMock}
      labels={props.labels}
      proposalStatus={props.proposalStatus}
      pendingCount={props.pendingCount}
      onProposals={props.onProposals}
      onAcceptProposal={props.onAcceptProposal}
      onRejectProposal={props.onRejectProposal}
      onAcceptAll={props.onAcceptAll}
      onRejectAll={props.onRejectAll}
      onEscape={confirm.requestClose}
      onRevealPending={props.onRevealPending}
      compact={surface === "quick"}
      fillHeight={surface === "dock"}
      footer={
        confirm.confirming && (
          <CloseConfirmBar
            labels={props.labels}
            pendingCount={props.pendingCount}
            onAcceptAll={props.onAcceptAll}
            onRejectAll={props.onRejectAll}
            onClose={props.onClose}
            onCancel={confirm.cancel}
          />
        )
      }
    />
  );
}
