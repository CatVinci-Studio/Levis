import type { Lang } from "../i18n/strings";
import "./LanguageWelcome.css";

const COPY: Record<
  Lang,
  { eyebrow: string; title: string; body: string; continue: string }
> = {
  en: {
    eyebrow: "Welcome to Levis",
    title: "Choose your language",
    body: "You can change this later in Settings.",
    continue: "Continue",
  },
  zh: {
    eyebrow: "欢迎使用 Levis",
    title: "选择你的语言",
    body: "之后仍可在设置中随时更改。",
    continue: "继续",
  },
  ja: {
    eyebrow: "Levisへようこそ",
    title: "言語を選択",
    body: "後から設定でいつでも変更できます。",
    continue: "続ける",
  },
};

const LANGUAGES: { id: Lang; label: string; detail: string }[] = [
  { id: "zh", label: "中文", detail: "简体中文" },
  { id: "en", label: "English", detail: "English" },
  { id: "ja", label: "日本語", detail: "日本語" },
];

export function LanguageWelcome({
  language,
  onLanguage,
  onContinue,
}: {
  language: Lang;
  onLanguage: (language: Lang) => void;
  onContinue: () => void;
}) {
  const copy = COPY[language];
  return (
    <div className="language-welcome-backdrop">
      <section
        className="language-welcome"
        role="dialog"
        aria-modal="true"
        aria-labelledby="language-welcome-title"
      >
        <div className="language-welcome-mark" aria-hidden>
          L
        </div>
        <div className="language-welcome-eyebrow">{copy.eyebrow}</div>
        <h1 id="language-welcome-title">{copy.title}</h1>
        <p>{copy.body}</p>
        <div className="language-welcome-options">
          {LANGUAGES.map((option) => (
            <button
              type="button"
              key={option.id}
              className={`language-welcome-option${language === option.id ? " is-selected" : ""}`}
              aria-pressed={language === option.id}
              onClick={() => onLanguage(option.id)}
            >
              <span>{option.label}</span>
              <small>{option.detail}</small>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="language-welcome-continue"
          onClick={onContinue}
          autoFocus
        >
          {copy.continue}
          <span aria-hidden>→</span>
        </button>
      </section>
    </div>
  );
}
