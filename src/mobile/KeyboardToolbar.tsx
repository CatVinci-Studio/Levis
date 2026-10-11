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
  TOGGLE_BLOCK_EVENT,
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

/** What the caret sits in, read off the editor's DOM: the heading level
 *  the H button shows, and which block buttons are on. */
interface CaretBlock {
  heading: number;
  bulletList: boolean;
  orderedList: boolean;
  quote: boolean;
}
const NO_BLOCK: CaretBlock = {
  heading: 0,
  bulletList: false,
  orderedList: false,
  quote: false,
};

function caretBlock(): CaretBlock {
  const node = document.getSelection()?.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el?.closest(".milkdown .ProseMirror")) return NO_BLOCK;
  const heading = el.closest("h1, h2, h3, h4, h5, h6");
  const list = el.closest("ul, ol");
  return {
    heading: heading ? Number(heading.tagName.slice(1)) : 0,
    bulletList: list?.tagName === "UL",
    orderedList: list?.tagName === "OL",
    quote: !!el.closest("blockquote"),
  };
}

export function KeyboardToolbar() {
  const { t, settings } = useSettings();
  const [editing, setEditing] = useState(false);
  const [block, setBlock] = useState<CaretBlock>(NO_BLOCK);

  useEffect(() => {
    if (!editing) return;
    // The DOM settles after ProseMirror's update; read it a frame later.
    const update = () => requestAnimationFrame(() => setBlock(caretBlock()));
    update();
    document.addEventListener("selectionchange", update);
    document.addEventListener("input", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("input", update);
    };
  }, [editing]);

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
    /** A toggle that is on where the caret is. */
    on?: boolean;
    run: () => void;
  };
  const toggle = (kind: string) => () => send(TOGGLE_BLOCK_EVENT, kind);
  const edit = (action: string) => () => send(EDIT_ACTION_EVENT, action);
  const groups: Button[][] = [
    [
      { label: t.menuUndo, content: <UndoIcon />, run: edit("undo") },
      { label: t.copy, content: <CopyIcon />, run: edit("copy") },
      { label: t.paste, content: <PasteIcon />, run: edit("paste") },
    ],
    [
      {
        // Each tap steps paragraph -> H1 -> H2 -> H3 -> paragraph.
        label: t.toolbarHeading,
        content: block.heading ? `H${block.heading}` : "H",
        on: block.heading > 0,
        run: toggle("heading"),
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
        on: block.bulletList,
        run: toggle("bullet-list"),
      },
      {
        label: t.menuOrderedList,
        content: <NumberedListIcon />,
        on: block.orderedList,
        run: toggle("ordered-list"),
      },
      {
        label: t.menuBlockquote,
        content: "❝",
        on: block.quote,
        run: toggle("blockquote"),
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
                aria-pressed={b.on}
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
          ✦ AI
        </button>
      )}
    </div>
  );
}
