import "./TutorialCard.css";

export interface TutorialCardLabels {
  /** "{i}"/"{n}" placeholders. */
  stepOfCount: string;
  back: string;
  next: string;
  finish: string;
  skip: string;
}

interface TutorialCardProps {
  stepIndex: number;
  totalSteps: number;
  title: string;
  body: string;
  labels: TutorialCardLabels;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

/**
 * A fixed, always-visible step card (bottom-right) that narrates the
 * welcome tutorial doc - it doesn't drive the document itself, just tells
 * the reader what to look for and try next. See useTutorial.ts for the
 * state machine and tutorial-steps.ts for the script.
 */
export function TutorialCard({ stepIndex, totalSteps, title, body, labels, onNext, onBack, onSkip }: TutorialCardProps) {
  const isLast = stepIndex === totalSteps - 1;
  return (
    <div className="tutorial-card floating-surface">
      <div className="tutorial-card-progress">
        {labels.stepOfCount.replace("{i}", String(stepIndex + 1)).replace("{n}", String(totalSteps))}
      </div>
      <div className="tutorial-card-title">{title}</div>
      <div className="tutorial-card-body">{body}</div>
      <div className="tutorial-card-actions">
        <button type="button" className="tutorial-card-skip" onClick={onSkip}>
          {labels.skip}
        </button>
        <div className="tutorial-card-nav">
          {stepIndex > 0 && (
            <button type="button" className="tutorial-card-btn" onClick={onBack}>
              {labels.back}
            </button>
          )}
          <button type="button" className="tutorial-card-btn tutorial-card-btn-primary" onClick={onNext}>
            {isLast ? labels.finish : labels.next}
          </button>
        </div>
      </div>
    </div>
  );
}
