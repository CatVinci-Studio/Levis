import { $prose } from "@milkdown/kit/utils";
import { createHighlightPlugin, type Parser } from "prosemirror-highlight";
import { createParser } from "prosemirror-highlight/refractor";
import { refractor } from "refractor";

// `refractor`'s default export bundles the ~40 most common languages
// (js/ts/python/rust/bash/json/css/html/...); good enough coverage without
// pulling in the full ~300-language "all" build.
const highlight = createParser(refractor);

// A fence in a language refractor doesn't bundle (mermaid, a typo, an
// exotic one) stays plain: passed through, refractor throws, and
// prosemirror-highlight logged that error on every edit to the block.
const parser: Parser = (options) =>
  !options.language || refractor.registered(options.language)
    ? highlight(options)
    : [];

export const syntaxHighlightPlugin = $prose(() =>
  createHighlightPlugin({ parser }),
);
