import { lazy, Suspense } from "react";
import { MilkdownProvider } from "@milkdown/react";
import { useSettings } from "../settings/SettingsContext";

const MilkdownEditor = lazy(() =>
  import("./MilkdownEditor").then((m) => ({ default: m.MilkdownEditor })),
);

interface EditorPaneProps {
  filePath: string | null;
  initialValue: string;
  onChange: (markdown: string) => void;
}

export function EditorPane({ filePath, initialValue, onChange }: EditorPaneProps) {
  // No file open yet -> still show an editable blank canvas (draft mode).
  // "untitled" as the key means switching between draft <-> a real file
  // (or between two different files) always remounts with a fresh document.
  const editorKey = filePath ?? "untitled";
  const { settings } = useSettings();

  return (
    <div className="editor-scroll">
      <div className={`editor-content ${settings.typewriterMode ? "typewriter-active" : ""}`}>
        <Suspense fallback={null}>
          <MilkdownProvider key={editorKey}>
            <MilkdownEditor filePath={filePath} initialValue={initialValue} onChange={onChange} />
          </MilkdownProvider>
        </Suspense>
      </div>
    </div>
  );
}
