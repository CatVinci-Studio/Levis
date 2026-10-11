import { useDeferredValue, useEffect, useMemo, useRef } from "react";
import { renderDocumentHtml } from "../ai/markdown-render";
import { resolveImageSrc } from "./image-plugin";
import { configureMermaid, loadMermaid } from "./mermaid-plugin";
import { SourceTextarea } from "./SourceTextarea";
import "./SplitView.css";

/**
 * Split view: the markdown source on the left, editable, and the rendered
 * document on the right - for people who think in markdown but want to see
 * the result. The preview is rendered from the source (renderDocumentHtml)
 * inside the editor's content classes, so the same theme styles it.
 *
 * Scrolling is kept in step by proportion; the side being scrolled by the
 * user leads, and a guard stops the other side's scroll event from echoing
 * back. With typewriter mode on, the source keeps the caret's line in the
 * middle the way the rich editor does.
 */
export function SplitView({
  content,
  filePath,
  typewriter,
  onChange,
}: {
  content: string;
  filePath: string | null;
  typewriter: boolean;
  onChange: (markdown: string) => void;
}) {
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // Typing stays responsive on long documents: the preview renders the
  // deferred value and catches up a beat later.
  const deferred = useDeferredValue(content);
  const html = useMemo(() => renderDocumentHtml(deferred), [deferred]);

  // Relative image paths resolve against the document's folder, as in the
  // editor; Mermaid fences become diagrams (loaded only when present).
  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;
    for (const img of root.querySelectorAll("img")) {
      const src = img.getAttribute("src");
      if (src) img.src = resolveImageSrc(src, filePath);
    }
    const diagrams = root.querySelectorAll<HTMLElement>(
      "pre > code.language-mermaid",
    );
    if (diagrams.length === 0) return;
    let cancelled = false;
    // The editor's own loader and settings: mermaid is one global, so a
    // second initialize() here would reset the editor's diagrams too.
    void loadMermaid().then(async (mermaid) => {
      configureMermaid(mermaid, root.clientWidth);
      let n = 0;
      for (const code of diagrams) {
        if (cancelled) return;
        try {
          const { svg } = await mermaid.render(
            `split-mermaid-${Date.now()}-${n++}`,
            code.textContent ?? "",
          );
          const box = document.createElement("div");
          box.className = "mermaid-preview";
          box.innerHTML = svg;
          code.parentElement?.replaceWith(box);
        } catch {
          // Incomplete diagram while typing: leave the source showing.
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [html, filePath]);

  const syncing = useRef<"source" | "preview" | null>(null);
  function follow(
    from: HTMLElement,
    to: HTMLElement,
    side: "source" | "preview",
  ) {
    if (syncing.current && syncing.current !== side) return;
    syncing.current = side;
    const range = from.scrollHeight - from.clientHeight;
    const ratio = range > 0 ? from.scrollTop / range : 0;
    to.scrollTop = ratio * (to.scrollHeight - to.clientHeight);
    requestAnimationFrame(() => {
      syncing.current = null;
    });
  }

  return (
    <div className="split-view">
      <SourceTextarea
        ref={sourceRef}
        className="split-source"
        value={content}
        typewriter={typewriter}
        onChange={onChange}
        onScroll={(e) =>
          previewRef.current &&
          follow(e.currentTarget, previewRef.current, "source")
        }
      />
      <div
        ref={previewRef}
        className="split-preview"
        onScroll={(e) =>
          sourceRef.current &&
          follow(e.currentTarget, sourceRef.current, "preview")
        }
      >
        <div className="milkdown">
          <div
            id="write"
            className="ProseMirror split-preview-body"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    </div>
  );
}
