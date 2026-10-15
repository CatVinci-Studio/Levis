// A file's line endings and byte-order mark, kept through an edit. The
// editor works in "\n" (ProseMirror normalises every line break), so a
// document is read in as "\n" without a BOM, and written back the way the
// file on disk already is: a Windows file saved from Textus stays CRLF, and
// a git diff shows the lines that changed instead of every line.

export interface FileFormat {
  crlf: boolean;
  bom: boolean;
}

const BOM = "﻿";

/** How `raw` (a file's text as read) ends its lines and whether it opens
 *  with a BOM. Mixed endings count by majority; a file with no line break
 *  at all is "\n". */
export function detectFormat(raw: string): FileFormat {
  const crlf = raw.match(/\r\n/g)?.length ?? 0;
  const lf = (raw.match(/\n/g)?.length ?? 0) - crlf;
  return { crlf: crlf > lf, bom: raw.startsWith(BOM) };
}

/** A file's text as the editor wants it: no BOM, "\n" line breaks. */
export function toEditorText(raw: string): string {
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  return text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
}

/** The editor's text as the file should hold it. */
export function toFileText(text: string, format: FileFormat): string {
  const lines = format.crlf ? text.replace(/\r?\n/g, "\r\n") : text;
  return format.bom ? BOM + lines : lines;
}
