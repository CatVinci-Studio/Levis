import { useMemo } from "react";
import { parseHeadings } from "./outline-parse";
import "./FileTree.css";

interface OutlineProps {
  content: string;
}

function scrollToHeading(index: number) {
  const container = document.querySelector(".editor-content");
  const heading = container?.querySelectorAll("h1, h2, h3, h4, h5, h6")[index];
  heading?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function Outline({ content }: OutlineProps) {
  const headings = useMemo(() => parseHeadings(content), [content]);

  if (headings.length === 0) {
    return null;
  }

  return (
    <div className="file-tree">
      {headings.map((h, i) => (
        <button
          key={i}
          className="tree-row"
          style={{ paddingLeft: (h.level - 1) * 14 + 12 }}
          onClick={() => scrollToHeading(i)}
        >
          <span className="tree-label">{h.text}</span>
        </button>
      ))}
    </div>
  );
}
