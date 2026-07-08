export interface WordCount {
  words: number;
  cjkChars: number;
}

const CJK_RANGE = /[一-鿿㐀-䶿]/g;

/**
 * Counts Latin-script words and CJK characters separately (CJK text isn't
 * naturally whitespace-delimited into "words", so it gets its own count).
 * Fenced code blocks are excluded so code doesn't inflate the prose count.
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

  const cjkChars = text.match(CJK_RANGE)?.length ?? 0;
  const words = text
    .replace(CJK_RANGE, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return { words, cjkChars };
}
