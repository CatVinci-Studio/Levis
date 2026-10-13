import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSettings } from "./SettingsContext";
import type { Category } from "./SettingsPanel";
import { PhoneNavBar } from "../mobile/PhoneNavBar";
import { ChevronIcon } from "../ui/icons";
import { useModalDialog } from "../ui/useModalDialog";
import "./PhoneSettings.css";

/**
 * Settings on an iPhone, laid out like the Settings app: a full-screen page
 * whose root is the list of categories, each pushing its own page with
 * "‹ Settings" to come back. The rows on those pages are the desktop
 * dialog's own (SettingsPanel's renderCategory), restyled as grouped lists
 * by PhoneSettings.css - only the shell and its navigation are the phone's.
 *
 * Done closes from anywhere; Escape (a hardware keyboard) steps back one
 * page first, as the system's navigation controller does.
 */
export function PhoneSettings({
  categories,
  renderCategory,
  onClose,
}: {
  categories: { id: Category; label: string }[];
  renderCategory: (category: Category) => ReactNode;
  onClose: () => void;
}) {
  const { t } = useSettings();
  const [open, setOpen] = useState<Category | null>(null);
  // Which way the last move went, for the slide: a pushed page comes in
  // from the right; going back, the list returns from the left.
  const [motion, setMotion] = useState<"push" | "pop" | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const lastOpened = useRef<Category | null>(null);

  const push = (category: Category) => {
    lastOpened.current = category;
    setMotion("push");
    setOpen(category);
  };
  const pop = () => {
    setMotion("pop");
    setOpen(null);
  };

  const modal = useModalDialog(open ? pop : onClose);

  // The button that was tapped is gone after a move, which would drop the
  // focus to <body> where VoiceOver and a keyboard lose their place: it
  // goes to the new page's back button, or back to the row it came from.
  useEffect(() => {
    if (open) backRef.current?.focus({ preventScroll: true });
    else if (lastOpened.current)
      listRef.current
        ?.querySelector<HTMLElement>(`[data-category="${lastOpened.current}"]`)
        ?.focus({ preventScroll: true });
  }, [open]);

  const label = categories.find((c) => c.id === open)?.label ?? "";

  return (
    <div
      {...modal}
      role="dialog"
      aria-modal="true"
      aria-label={t.settingsTitle}
      className="settings-panel settings-phone"
    >
      <PhoneNavBar
        title={open ? label : t.settingsTitle}
        back={open ? { label: t.settingsTitle, onTap: pop } : undefined}
        done={{ label: t.settingsDone, onTap: onClose }}
        backRef={backRef}
      />
      {open ? (
        <div
          key={open}
          className={`settings-phone-body settings-phone-page${motion === "push" ? " settings-phone-push" : ""}`}
          role="region"
          aria-label={label}
        >
          {renderCategory(open)}
        </div>
      ) : (
        <div
          className={`settings-phone-body${motion === "pop" ? " settings-phone-pop" : ""}`}
        >
          <ul className="settings-phone-list" ref={listRef}>
            {categories.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="settings-phone-row"
                  data-category={c.id}
                  onClick={() => push(c.id)}
                >
                  <span
                    className={`settings-phone-icon settings-phone-icon-${c.id}`}
                    aria-hidden
                  >
                    {CATEGORY_ICONS[c.id]}
                  </span>
                  <span className="settings-phone-row-label">{c.label}</span>
                  <ChevronIcon className="settings-phone-chevron" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// White glyphs for the coloured tiles beside each category, as the
// Settings app marks its rows. 20x20, drawn on a 29pt tile.
const glyph = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
    {children}
  </svg>
);

const CATEGORY_ICONS: Partial<Record<Category, ReactNode>> = {
  // A gear: a ring with eight teeth.
  general: glyph(
    <>
      <circle
        cx="10"
        cy="10"
        r="4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
      />
      <path
        d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3M4 4l2.1 2.1M13.9 13.9L16 16M4 16l2.1-2.1M13.9 6.1L16 4"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </>,
  ),
  // A pen: writing and how it looks.
  editor: glyph(
    <path d="M3 17l1.2-4.4L13 3.8a1.6 1.6 0 0 1 2.3 0l.9.9a1.6 1.6 0 0 1 0 2.3L7.4 15.8z" />,
  ),
  // The four-point sparkle the app marks its AI with.
  ai: glyph(<path d="M10 1.5l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5-6.5-2 6.5-2z" />),
  // A speech bubble: the conversation with Levis AI.
  agent: glyph(
    <path d="M4 3h12a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H9.5L5.5 18v-3.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />,
  ),
  // A padlock.
  privacy: glyph(
    <>
      <path
        d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <rect x="4" y="8.5" width="12" height="9" rx="2" />
    </>,
  ),
};
