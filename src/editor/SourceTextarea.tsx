import type { Ref, TextareaHTMLAttributes } from "react";
import { centerTextareaCaret } from "./mode-switch";

type Props = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "onChange" | "onSelect"
> & {
  value: string;
  onChange: (markdown: string) => void;
  /** Typewriter mode: keep the caret's line in the middle. */
  typewriter: boolean;
  ref?: Ref<HTMLTextAreaElement>;
};

/** The plain-Markdown editor of source mode and split view. */
export function SourceTextarea({
  onChange,
  typewriter,
  className,
  ...rest
}: Props) {
  return (
    <textarea
      {...rest}
      className={`source-view ${className ?? ""}${typewriter ? " typewriter-source" : ""}`}
      spellCheck={false}
      onChange={(e) => {
        onChange(e.target.value);
        const el = e.currentTarget;
        // After React has applied the new value and the caret moved.
        if (typewriter) requestAnimationFrame(() => centerTextareaCaret(el));
      }}
      onSelect={(e) => typewriter && centerTextareaCaret(e.currentTarget)}
    />
  );
}
