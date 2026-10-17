import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import type { CopyTextMode } from "../../settings/SettingsContext";
import { plainTextOf } from "./plain-text";

/**
 * The plain text of a copy, as the Copy setting says (Settings > Editor >
 * Markdown): the words as they read (plain-text.ts) by default, for the
 * apps that paste only plain text. In Markdown mode it steps aside, and
 * milkdown's clipboard plugin, registered after it, writes the Markdown
 * source as before. ProseMirror takes the first serializer that returns
 * text, so this must come before that plugin.
 */
export function createPlainTextCopyPlugin(mode: () => CopyTextMode) {
  return $prose(
    () =>
      new Plugin({
        props: {
          clipboardTextSerializer: (slice) =>
            mode() === "readable" ? plainTextOf(slice.content) : "",
        },
      }),
  );
}
