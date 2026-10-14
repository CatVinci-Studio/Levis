import { useMemo, useState } from "react";
import { parseHeadings } from "./outline-parse";
import { ChevronIcon } from "../ui/icons";
import { useSettings } from "../settings/SettingsContext";
import { scrollBehavior } from "../ui/motion";
import "./FileTree.css";

interface OutlineProps {
  content: string;
}

function scrollToHeading(index: number) {
  // Every tab's editor stays mounted, so scope to the active one. Top-level
  // headings only: parseHeadings never counts one inside a quote or list
  // (its line doesn't start with "#"), nor do h1-h6 inside a Quick Ask
  // reply or a raw HTML preview belong to the document's outline.
  const root = document.querySelector(
    '[data-active-tab="true"] .editor-content .ProseMirror',
  );
  const heading = root?.querySelectorAll(
    ":scope > :is(h1, h2, h3, h4, h5, h6)",
  )[index];
  heading?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
}

/** A heading's source as it reads in the document: inline code, emphasis
 *  and link syntax dropped, so "`text-spacing`" shows as text-spacing. */
export function headingLabel(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]+)`+/g, "$1")
    .replace(/(\*\*|__|~~|==)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/([*_])(?=\S)(.+?)(?<=\S)\1/g, "$2");
}

export function Outline({ content }: OutlineProps) {
  const { t } = useSettings();
  const headings = useMemo(() => {
    // A heading is remembered as collapsed by level + text + which repeat
    // of that pair it is, not by index: typing a new heading above it must
    // not move the collapse onto a different section.
    const seen = new Map<string, number>();
    return parseHeadings(content).map((h, index, all) => {
      const base = `${h.level}|${h.text}`;
      const nth = seen.get(base) ?? 0;
      seen.set(base, nth + 1);
      const next = all[index + 1];
      return {
        ...h,
        index,
        id: `${base}|${nth}`,
        hasChildren: next !== undefined && next.level > h.level,
      };
    });
  }, [content]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const visible = useMemo(() => {
    const rows: typeof headings = [];
    // While inside a collapsed section, everything deeper than its heading
    // stays hidden until a heading at its level or above closes it.
    let hiddenBelow = Infinity;
    for (const h of headings) {
      if (h.level > hiddenBelow) continue;
      hiddenBelow = Infinity;
      rows.push(h);
      if (h.hasChildren && collapsed.has(h.id)) hiddenBelow = h.level;
    }
    return rows;
  }, [headings, collapsed]);

  if (headings.length === 0) {
    return <div className="clipboard-empty">{t.outlineEmpty}</div>;
  }

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="file-tree">
      {visible.map((h) => {
        const isCollapsed = collapsed.has(h.id);
        return (
          <div
            key={h.id}
            className="outline-row"
            style={{ paddingLeft: (h.level - 1) * 14 }}
          >
            {h.hasChildren ? (
              <button
                className="outline-toggle"
                onClick={() => toggle(h.id)}
                title={isCollapsed ? t.outlineExpand : t.outlineCollapse}
                aria-label={isCollapsed ? t.outlineExpand : t.outlineCollapse}
                aria-expanded={!isCollapsed}
              >
                <ChevronIcon
                  className={`chevron ${isCollapsed ? "" : "chevron-open"}`}
                />
              </button>
            ) : (
              <span className="outline-toggle-spacer" />
            )}
            <button
              className="tree-row"
              onClick={() => scrollToHeading(h.index)}
            >
              <span className="tree-label">{headingLabel(h.text)}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
