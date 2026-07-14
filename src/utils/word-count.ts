export interface WordCount {
  words: number;
}

const segmenter: Intl.Segmenter | undefined =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : undefined;

/**
 * Counts words via Intl.Segmenter, which locates word boundaries in
 * CJK scripts (no whitespace between words) the same way it does for
 * Latin text. Fenced code blocks are excluded so code doesn't inflate
 * the prose count.
 */
export function countWords(markdown: string): WordCount {
  let text = "";
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    text += line + "\n";
  }

  if (!segmenter) {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return { words };
  }

  let words = 0;
  for (const { isWordLike } of segmenter.segment(text)) {
    if (isWordLike) words++;
  }
  return { words };
}
