export interface HeadingInfo {
  level: number;
  text: string;
}

/**
 * Parses ATX headings (# ... ######) out of raw markdown, skipping
 * fenced code blocks so a shell comment like `# foo` isn't mistaken
 * for a heading.
 */
export function parseHeadings(markdown: string): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  let inFence = false;

  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      headings.push({ level: match[1].length, text: match[2] });
    }
  }

  return headings;
}
