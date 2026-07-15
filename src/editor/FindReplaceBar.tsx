import { useState } from "react";
import type { FindReplace } from "./useFindReplace";
import "./FindReplaceBar.css";

interface FindReplaceBarLabels {
  findPlaceholder: string;
  replacePlaceholder: string;
  replace: string;
  replaceAll: string;
  matchCase: string;
  useRegex: string;
  invalidRegex: string;
  noMatches: string;
}

interface FindReplaceBarProps {
  findReplace: FindReplace;
  labels: FindReplaceBarLabels;
}

export function FindReplaceBar({ findReplace, labels }: FindReplaceBarProps) {
  const [replaceOpen, setReplaceOpen] = useState(false);
  const { query, replacement, caseSensitive, useRegex, status } = findReplace;

  function onFindKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) findReplace.prev();
      else findReplace.next();
    } else if (e.key === "Escape") {
      e.preventDefault();
      findReplace.close();
    }
  }

  function onReplaceKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      findReplace.replaceOne();
    } else if (e.key === "Escape") {
      e.preventDefault();
      findReplace.close();
    }
  }

  const countLabel = status.error
    ? labels.invalidRegex
    : query
      ? status.matchCount > 0
        ? `${status.activeIndex + 1} / ${status.matchCount}`
        : labels.noMatches
      : "";

  return (
    <div className="find-replace-bar" onKeyDown={(e) => e.stopPropagation()}>
      <div className="find-replace-row">
        <button
          type="button"
          className={`find-replace-chevron ${replaceOpen ? "find-replace-chevron-open" : ""}`}
          title={labels.replace}
          onClick={() => setReplaceOpen((v) => !v)}
        >
          ▸
        </button>
        <div className="find-replace-field">
          <input
            className="find-replace-input"
            type="text"
            value={query}
            placeholder={labels.findPlaceholder}
            autoFocus
            onChange={(e) => findReplace.setQuery(e.target.value)}
            onKeyDown={onFindKeyDown}
          />
          <span className={`find-replace-count ${status.error ? "find-replace-count-error" : ""}`}>{countLabel}</span>
          <button
            type="button"
            className={`find-replace-toggle ${caseSensitive ? "find-replace-toggle-active" : ""}`}
            title={labels.matchCase}
            onClick={findReplace.toggleCaseSensitive}
          >
            Aa
          </button>
          <button
            type="button"
            className={`find-replace-toggle ${useRegex ? "find-replace-toggle-active" : ""}`}
            title={labels.useRegex}
            onClick={findReplace.toggleUseRegex}
          >
            .*
          </button>
        </div>
        <div className="find-replace-nav">
          <button type="button" onClick={findReplace.prev} disabled={status.matchCount === 0}>
            ↑
          </button>
          <button type="button" onClick={findReplace.next} disabled={status.matchCount === 0}>
            ↓
          </button>
          <button type="button" className="find-replace-close" onClick={findReplace.close}>
            ×
          </button>
        </div>
      </div>
      {replaceOpen && (
        <div className="find-replace-row">
          <span className="find-replace-chevron-spacer" />
          <div className="find-replace-field">
            <input
              className="find-replace-input"
              type="text"
              value={replacement}
              placeholder={labels.replacePlaceholder}
              onChange={(e) => findReplace.setReplacement(e.target.value)}
              onKeyDown={onReplaceKeyDown}
            />
          </div>
          <div className="find-replace-nav">
            <button type="button" onClick={findReplace.replaceOne} disabled={status.matchCount === 0}>
              {labels.replace}
            </button>
            <button type="button" onClick={findReplace.replaceAll} disabled={status.matchCount === 0}>
              {labels.replaceAll}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
