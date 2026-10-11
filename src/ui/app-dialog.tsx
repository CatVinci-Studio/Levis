import { useEffect, useState } from "react";
import { useModalDialog } from "./useModalDialog";

/**
 * The app's own alert and confirm boxes, in place of the OS dialogs
 * (@tauri-apps/plugin-dialog's `message`/`ask`), which drew a GTK or Win32
 * box in the middle of an otherwise themed window. Callable from anywhere -
 * export code and editor plugins have no React tree of their own - and
 * shown by the one AppDialogHost that App mounts. Requests queue: a second
 * one waits for the first to be answered.
 */
export interface AppDialogOptions {
  title?: string;
  /** Tints the title; a plain notice by default. */
  tone?: "info" | "warning" | "error";
}

interface Request extends AppDialogOptions {
  id: number;
  text: string;
  /** Confirm only: the action button and the way out. */
  okLabel?: string;
  cancelLabel?: string;
  confirm: boolean;
  resolve: (ok: boolean) => void;
}

let nextId = 1;
let queue: Request[] = [];
const listeners = new Set<(queue: Request[]) => void>();

function publish() {
  for (const listener of listeners) listener(queue);
}

function enqueue(request: Omit<Request, "id" | "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { ...request, id: nextId++, resolve }];
    publish();
  });
}

/** A notice with one button. Resolves once it is dismissed. */
export async function showMessage(
  text: string,
  options: AppDialogOptions = {},
): Promise<void> {
  await enqueue({ ...options, text, confirm: false });
}

/** A yes/no question. Resolves true for the action button, false for
 *  cancel, Escape or the backdrop. */
export function showConfirm(
  text: string,
  options: AppDialogOptions & { okLabel: string; cancelLabel: string },
): Promise<boolean> {
  return enqueue({ ...options, text, confirm: true });
}

function answer(request: Request, ok: boolean) {
  queue = queue.filter((r) => r.id !== request.id);
  publish();
  request.resolve(ok);
}

/** Mounted once, by App. */
export function AppDialogHost({ okLabel }: { okLabel: string }) {
  const [pending, setPending] = useState<Request[]>(queue);
  useEffect(() => {
    listeners.add(setPending);
    return () => {
      listeners.delete(setPending);
    };
  }, []);
  const current = pending[0];
  const dialog = useModalDialog(
    () => current && answer(current, false),
    !!current,
    ".close-prompt-primary",
  );
  if (!current) return null;
  return (
    <div
      className="close-prompt-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) answer(current, false);
      }}
    >
      <div
        key={current.id}
        className="close-prompt app-dialog"
        {...dialog}
        role={current.confirm ? "dialog" : "alertdialog"}
        aria-modal="true"
        aria-label={current.title ?? current.text}
      >
        {current.title && (
          <h2
            className={`app-dialog-title app-dialog-${current.tone ?? "info"}`}
          >
            {current.title}
          </h2>
        )}
        <p>{current.text}</p>
        <div className="close-prompt-buttons">
          <div className="close-prompt-spacer" />
          {current.confirm && (
            <button onClick={() => answer(current, false)}>
              {current.cancelLabel}
            </button>
          )}
          <button
            className="close-prompt-primary"
            onClick={() => answer(current, true)}
          >
            {current.confirm ? current.okLabel : okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
