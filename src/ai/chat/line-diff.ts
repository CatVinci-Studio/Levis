export type DiffKind = "context" | "add" | "remove";

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

/**
 * Above this many lines on either side, the LCS table costs more than the
 * result is worth reading - a diff that long is scrolled past, not studied.
 * Such a pair is shown as a plain remove-all/add-all block instead.
 */
const MAX_LCS_LINES = 400;

/**
 * Line-level diff of two markdown snippets, for the proposal card.
 *
 * A proposal used to render as one struck block followed by one inserted
 * block, which for a reworded sentence inside a paragraph meant reading the
 * whole paragraph twice to find the change. Lining the two up says what
 * actually moved.
 *
 * Plain LCS: proposals are a handful of lines, and the alternative (a
 * word-level or Myers diff) is a lot of machinery for a card that is read for
 * a second or two before being accepted.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.length === 0 ? [] : before.split("\n");
  const b = after.length === 0 ? [] : after.split("\n");

  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) return b.map((text) => ({ kind: "add" as const, text }));
  if (b.length === 0)
    return a.map((text) => ({ kind: "remove" as const, text }));
  if (a.length > MAX_LCS_LINES || b.length > MAX_LCS_LINES) {
    return [
      ...a.map((text) => ({ kind: "remove" as const, text })),
      ...b.map((text) => ({ kind: "add" as const, text })),
    ];
  }

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "context", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "remove", text: a[i] });
      i++;
    } else {
      out.push({ kind: "add", text: b[j] });
      j++;
    }
  }
  while (i < a.length) out.push({ kind: "remove", text: a[i++] });
  while (j < b.length) out.push({ kind: "add", text: b[j++] });
  return out;
}

/** Whether a diff is big enough to be worth collapsing behind a toggle. */
export function isLongDiff(lines: DiffLine[]): boolean {
  return lines.length > 12;
}
