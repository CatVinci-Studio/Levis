/**
 * An outgoing chat message carries more than what the user typed: the
 * selection they had, and any files they attached, wrapped in tags the model
 * reads as context (see InlineChat's send path). That tagged string is also
 * the history replayed to the model on the next turn, so it can't be
 * simplified away at send time - but showing it verbatim in the transcript
 * put a wall of XML and the user's own selected text in place of the one
 * sentence they actually wrote.
 *
 * Parsing it back apart at render time keeps both: the wire format is
 * untouched (and conversations restored from history parse the same way),
 * while the bubble shows the prose and folds the context into chips.
 *
 * WRITING the format lives here too. It used to be written inline in
 * ChatBody's send path and read by two different regexes (here and in
 * chat-history's title cleaner), so three places had to agree on it with
 * nothing checking that they did - and every way of getting it wrong is
 * silent: chips stop appearing, or a wall of raw XML shows up as a
 * conversation's title.
 */

/** Wraps the selection the message rode out with. */
export function selectedTextBlock(markdown: string): string {
  return `<selected-text>\n${markdown}\n</selected-text>`;
}

/** Wraps one attachment's extracted text. */
export function attachedFileBlock(name: string, content: string): string {
  return `<attached-file name="${name}">\n${content}\n</attached-file>`;
}

/** The message with every context block stripped and nothing parsed out -
 *  for callers that only want the prose, like the history list's title. */
export function userMessageBody(text: string): string {
  return parseUserMessage(text).body;
}

export interface ParsedUserMessage {
  /** What the user actually typed, with the context blocks removed. */
  body: string;
  /** The <selected-text> block's content, if the message carried one. */
  selection: string | null;
  /** File names from any <attached-file name="..."> blocks, in order. */
  attachments: string[];
}

const SELECTED_TEXT = /<selected-text>\n?([\s\S]*?)\n?<\/selected-text>\n*/;
const ATTACHED_FILE =
  /<attached-file name="([^"]*)">\n?[\s\S]*?\n?<\/attached-file>\n*/g;

export function parseUserMessage(text: string): ParsedUserMessage {
  const attachments: string[] = [];
  let body = text.replace(ATTACHED_FILE, (_full, name: string) => {
    attachments.push(name);
    return "";
  });

  let selection: string | null = null;
  const selectionMatch = SELECTED_TEXT.exec(body);
  if (selectionMatch) {
    selection = selectionMatch[1];
    body = body.replace(SELECTED_TEXT, "");
  }

  return { body: body.trim(), selection, attachments };
}
