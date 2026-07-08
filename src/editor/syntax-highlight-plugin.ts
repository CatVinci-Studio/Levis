import { $prose } from "@milkdown/kit/utils";
import { createHighlightPlugin } from "prosemirror-highlight";
import { createParser } from "prosemirror-highlight/refractor";
import { refractor } from "refractor";

// `refractor`'s default export bundles the ~40 most common languages
// (js/ts/python/rust/bash/json/css/html/...); good enough coverage without
// pulling in the full ~300-language "all" build.
export const syntaxHighlightPlugin = $prose(() =>
  createHighlightPlugin({
    parser: createParser(refractor),
  }),
);
