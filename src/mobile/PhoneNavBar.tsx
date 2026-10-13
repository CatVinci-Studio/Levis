import type { Ref } from "react";
import "./PhoneNavBar.css";

/**
 * UIKit's navigation bar for a full-screen phone page: the title centred
 * on the screen, "‹ Parent" at the left when the page was pushed from
 * another, and the page's own action (Done) at the right. The back button
 * is named after the page it returns to, as iOS names it, so a reader of
 * the bar knows where it leads without a separate "Back" word.
 */
export function PhoneNavBar({
  title,
  back,
  done,
  backRef,
}: {
  title: string;
  back?: { label: string; onTap: () => void };
  done?: { label: string; onTap: () => void };
  /** Focus lands here when a page is pushed (SettingsPanel's phone shell). */
  backRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <header className="phone-nav-bar">
      {back ? (
        <button
          ref={backRef}
          type="button"
          className="phone-nav-back"
          onClick={back.onTap}
        >
          <svg
            className="phone-nav-back-chevron"
            width="12"
            height="20"
            viewBox="0 0 12 20"
            aria-hidden
          >
            <path
              d="M10 2L2 10L10 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{back.label}</span>
        </button>
      ) : (
        <span />
      )}
      <h2 className="phone-nav-title">{title}</h2>
      {done ? (
        <button type="button" className="phone-nav-done" onClick={done.onTap}>
          {done.label}
        </button>
      ) : (
        <span />
      )}
    </header>
  );
}
