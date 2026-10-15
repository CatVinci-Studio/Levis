/**
 * Sentence-level diff for partially accepting a rewrite: the proposal card
 * lists each changed sentence (group) with a checkbox, and the accepted
 * text is the original with only the checked changes applied.
 *
 * Sentences, not words: a word-level pick produces Frankenstein grammar,
 * while a writer judging a rewrite thinks "keep this sentence, not that
 * one". Ends at CJK and Latin terminators and line breaks; a terminator
 * keeps its trailing quote/bracket and whitespace with it, so joining the
 * pieces reproduces the text exactly.
 */

export type SentenceHunk =
  | { kind: "same"; text: string }
  | { kind: "change"; before: string; after: string };

export function splitSentences(text: string): string[] {
  const parts =
    text.match(
      /[^。！？!?.;；\n]*(?:[。！？!?;；]+|\.(?=\s|$)|\n+|$)[”’"')）」』\]]*\s*/g,
    ) ?? [];
  const out = parts.filter((p) => p.length > 0);
  // Anything the pattern skipped (shouldn't happen) is kept rather than lost.
  return out.join("") === text ? out : [text];
}

/** LCS over sentences, then runs of non-matching sentences become change
 *  hunks (see flush). */
export function diffSentences(before: string, after: string): SentenceHunk[] {
  const a = splitSentences(before);
  const b = splitSentences(after);
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] =
        a[i].trim() === b[j].trim()
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const hunks: SentenceHunk[] = [];
  let pendingBefore: string[] = [];
  let pendingAfter: string[] = [];
  // A run of changed sentences becomes one change - or, when as many
  // sentences go as come, one change per pair: a rewrite that tightens
  // three sentences in a row is three decisions, not one.
  const flush = () => {
    if (
      pendingBefore.length > 1 &&
      pendingBefore.length === pendingAfter.length
    )
      pendingBefore.forEach((before, k) =>
        hunks.push({ kind: "change", before, after: pendingAfter[k] }),
      );
    else if (pendingBefore.length || pendingAfter.length)
      hunks.push({
        kind: "change",
        before: pendingBefore.join(""),
        after: pendingAfter.join(""),
      });
    pendingBefore = [];
    pendingAfter = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].trim() === b[j].trim()) {
      flush();
      hunks.push({ kind: "same", text: b[j] });
      i++;
      j++;
    } else if (
      j < b.length &&
      (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])
    ) {
      pendingAfter.push(b[j++]);
    } else {
      pendingBefore.push(a[i++]);
    }
  }
  flush();
  return hunks;
}

/** The text with only the chosen changes applied (`take[k]` for the k-th
 *  change hunk; unlisted ones are taken). */
export function composeSentences(
  hunks: SentenceHunk[],
  take: boolean[],
): string {
  let k = 0;
  return hunks
    .map((h) => {
      if (h.kind === "same") return h.text;
      const use = take[k++] ?? true;
      return use ? h.after : h.before;
    })
    .join("");
}
