import { useEffect, useState, type ReactNode } from "react";
import { useSettings } from "../settings/SettingsContext";
import {
  BulletListIcon,
  CopyIcon,
  NumberedListIcon,
  PasteIcon,
  UndoIcon,
} from "../ui/icons";
import {
  EDIT_ACTION_EVENT,
  INSERT_BLOCK_EVENT,
  TOGGLE_FLOATING_CHAT_EVENT,
  TOGGLE_MARK_EVENT,
} from "../utils/events";
import "./KeyboardToolbar.css";

/**
 * The strip above the iPhone keyboard while the document is being edited:
 * undo, copy and paste; formatting without typing Markdown symbols; and
 * Quick Ask at the caret -
 * which has no other way in on a phone (no shortcut, and a long press
 * brings up the system's text menu, not Levis's).
 *
 * The buttons keep the editor's focus, so the keyboard stays up and the
 * caret where it was: a touch runs the button on touchend and cancels the
 * default there, which is what would move focus to the button (and the
 * click that would follow). They reach the editor the
 * way the menus do, through window events (utils/events.ts).
 */
const send = (event: string, detail?: string) =>
  window.dispatchEvent(new CustomEvent(event, { detail }));

/** Props that run `action` without taking focus from the editor. */
function keepFocus(action: () => void) {
  return {
    onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
    onTouchEnd: (e: React.TouchEvent) => {
      e.preventDefault();
      action();
    },
    onClick: action,
  };
}

export function KeyboardToolbar() {
  const { t, settings } = useSettings();
  const [editing, setEditing] = useState(false);

  // Up while a document editor has focus - which on a phone is exactly
  // while its keyboard is up.
  useEffect(() => {
    // Quick Ask's composer sits inside the editor's DOM (a widget at the
    // caret), but typing there is not editing the document.
    const inEditor = (node: EventTarget | null) =>
      node instanceof Element &&
      !!node.closest(".milkdown .ProseMirror") &&
      !node.closest(".inline-chat");
    const onIn = (e: FocusEvent) => setEditing(inEditor(e.target));
    const onOut = (e: FocusEvent) => {
      if (!inEditor(e.relatedTarget)) setEditing(false);
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("has-keyboard-toolbar", editing);
  }, [editing]);

  if (!editing) return null;

  type Button = {
    label: string;
    content: ReactNode;
    className?: string;
    run: () => void;
  };
  const edit = (action: string) => () => send(EDIT_ACTION_EVENT, action);
  const groups: Button[][] = [
    [
      { label: t.menuUndo, content: <UndoIcon />, run: edit("undo") },
      { label: t.copy, content: <CopyIcon />, run: edit("copy") },
      { label: t.paste, content: <PasteIcon />, run: edit("paste") },
    ],
    [
      {
        label: t.menuHeadingTemplate.replace("{n}", "2"),
        content: "H",
        run: () => send(INSERT_BLOCK_EVENT, "h2"),
      },
      {
        label: t.toolbarBold,
        content: "B",
        className: "kbt-bold",
        run: () => send(TOGGLE_MARK_EVENT, "bold"),
      },
      {
        label: t.toolbarItalic,
        content: "I",
        className: "kbt-italic",
        run: () => send(TOGGLE_MARK_EVENT, "italic"),
      },
    ],
    [
      {
        label: t.menuBulletList,
        content: <BulletListIcon />,
        run: () => send(INSERT_BLOCK_EVENT, "bullet-list"),
      },
      {
        label: t.menuOrderedList,
        content: <NumberedListIcon />,
        run: () => send(INSERT_BLOCK_EVENT, "ordered-list"),
      },
      {
        label: t.menuBlockquote,
        content: "❝",
        run: () => send(INSERT_BLOCK_EVENT, "blockquote"),
      },
      {
        label: t.menuCodeBlock,
        content: "</>",
        className: "kbt-code",
        run: () => send(INSERT_BLOCK_EVENT, "code-block"),
      },
    ],
  ];

  return (
    <div
      className="keyboard-toolbar"
      role="toolbar"
      aria-label={t.toolbarLabel}
    >
      <div className="keyboard-toolbar-format">
        {groups.map((group, g) => (
          <div key={g} className="keyboard-toolbar-group">
            {group.map((b) => (
              <button
                key={b.label}
                type="button"
                className={`keyboard-toolbar-button ${b.className ?? ""}`}
                aria-label={b.label}
                {...keepFocus(b.run)}
              >
                {b.content}
              </button>
            ))}
          </div>
        ))}
      </div>
      {settings.enableAskAi && (
        <button
          type="button"
          className="keyboard-toolbar-button keyboard-toolbar-ai"
          aria-label={t.askAi}
          {...keepFocus(() => send(TOGGLE_FLOATING_CHAT_EVENT))}
        >
          ✦
        </button>
      )}
    </div>
  );
}
