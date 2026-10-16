const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function plainMarkdownText(text: string): string {
  return text
    .replace(/\s+#+\s*$/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_~]/g, "")
    .trim();
}

/** Finds the first real Markdown level-one heading, excluding fenced code. */
export function firstLevelOneHeading(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/);
  let fence: { marker: "`" | "~"; length: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as "`" | "~";
      if (!fence) fence = { marker, length: fenceMatch[1].length };
      else if (fence.marker === marker && fenceMatch[1].length >= fence.length)
        fence = null;
      continue;
    }
    if (fence) continue;

    const atx = /^ {0,3}#(?:[ \t]+|$)(.*)$/.exec(line);
    if (atx) {
      const heading = plainMarkdownText(atx[1]);
      if (heading) return heading;
    }

    if (
      line.trim() &&
      index + 1 < lines.length &&
      /^ {0,3}=+[ \t]*$/.test(lines[index + 1])
    ) {
      const heading = plainMarkdownText(line.trim());
      if (heading) return heading;
    }
  }
  return null;
}

/** Finds the first visible, non-empty body line when no H1 is available. */
export function firstContentLine(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/);
  let fence: { marker: "`" | "~"; length: number } | null = null;
  let frontmatter = false;
  let htmlComment = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (index === 0 && trimmed === "---") {
      frontmatter = true;
      continue;
    }
    if (frontmatter) {
      if (trimmed === "---" || trimmed === "...") frontmatter = false;
      continue;
    }

    if (htmlComment) {
      if (line.includes("-->")) htmlComment = false;
      continue;
    }
    if (trimmed.startsWith("<!--")) {
      if (!trimmed.includes("-->")) htmlComment = true;
      continue;
    }

    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as "`" | "~";
      if (!fence) fence = { marker, length: fenceMatch[1].length };
      else if (fence.marker === marker && fenceMatch[1].length >= fence.length)
        fence = null;
      continue;
    }
    if (fence || !trimmed) continue;
    if (/^ {0,3}(?:={2,}|-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line)) continue;
    if (/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line)) continue;

    const withoutBlockMarkers = line
      .replace(/^ {0,3}(?:#{1,6}[ \t]+)?/, "")
      .replace(/^(?:[ \t]*>[ \t]*)+/, "")
      .replace(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/, "");
    const content = plainMarkdownText(withoutBlockMarkers);
    if (content) return content;
  }
  return null;
}

/** Produces one cross-platform-safe Markdown filename for a native dialog. */
export function markdownFilename(title: string, fallback: string): string {
  let stem = title.normalize("NFC").replace(/[<>:"/\\|?*]/g, "-");
  stem = [...stem]
    .map((character) => (character.charCodeAt(0) <= 31 ? "-" : character))
    .join("")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  if (/\.md$/i.test(stem)) stem = stem.slice(0, -3).replace(/[. ]+$/g, "");
  if (!stem) stem = fallback;
  if (WINDOWS_RESERVED_NAME.test(stem)) stem = `_${stem}`;
  stem = [...stem]
    .slice(0, 100)
    .join("")
    .replace(/[. ]+$/g, "");
  return `${stem || fallback}.md`;
}

export function defaultMarkdownFilename(
  markdown: string,
  fallback: string,
  useHeading: boolean,
): string {
  const title = useHeading
    ? (firstLevelOneHeading(markdown) ?? firstContentLine(markdown))
    : null;
  return markdownFilename(title ?? fallback, fallback);
}
