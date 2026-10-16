import type { EditorView } from "@milkdown/kit/prose/view";
import { NotePopover } from "./ReviewMargin";
import type { ReviewNote } from "./review-notes-plugin";
import { BottomCard } from "../../ui/BottomCard";
import { Presence } from "../../ui/usePresence";
import type { Strings } from "../../i18n/strings";

/** A review note opened from its numbered badge (no room for a margin): a
 *  popover under the badge, or on a phone a card from the bottom. */
export function OpenReviewNote({
  note,
  at,
  phone,
  editorView,
  t,
  onDone,
  onAsk,
  onClose,
}: {
  note: ReviewNote | null;
  /** Where the badge was; null while no note is open. */
  at: { x: number; y: number } | null;
  phone: boolean;
  editorView: EditorView | null;
  t: Strings;
  onDone: (id: string) => void;
  onAsk: (note: ReviewNote) => void;
  onClose: () => void;
}) {
  return (
    <>
      {note && at && !phone && (
        <NotePopover
          note={note}
          x={at.x}
          y={at.y}
          labels={t}
          onDone={onDone}
          onAsk={onAsk}
          onClose={onClose}
        />
      )}
      <Presence show={!!note && phone} exitMs={250}>
        {note && phone && (
          <BottomCard
            label={t.reviewNoteBy}
            actions={[
              {
                label: t.reviewNoteAsk,
                onSelect: () => onAsk(note),
              },
              {
                label: t.reviewNoteDone,
                primary: true,
                onSelect: () => onDone(note.id),
              },
            ]}
            onClose={onClose}
          >
            <div className="bottom-card-kicker">
              <span className="review-note-mark" aria-hidden="true">
                AI
              </span>
              {t.reviewNoteBy}
            </div>
            <p className="bottom-card-quote">
              {editorView?.state.doc.textBetween(note.from, note.to, " ")}
            </p>
            {note.comment}
          </BottomCard>
        )}
      </Presence>
    </>
  );
}
