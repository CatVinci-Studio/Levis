import {
  commonmark,
  strongSchema,
  strongAttr,
  strongInputRule,
  strongKeymap,
  toggleStrongCommand,
  emphasisSchema,
  emphasisAttr,
  emphasisStarInputRule,
  emphasisUnderscoreInputRule,
  emphasisKeymap,
  toggleEmphasisCommand,
  inlineCodeSchema,
  inlineCodeAttr,
  inlineCodeInputRule,
  inlineCodeKeymap,
  toggleInlineCodeCommand,
} from "@milkdown/kit/preset/commonmark";
import {
  gfm,
  strikethroughSchema,
  strikethroughAttr,
  strikethroughInputRule,
  strikethroughKeymap,
  toggleStrikethroughCommand,
} from "@milkdown/kit/preset/gfm";

// Bold/italic/strikethrough/inline code are handled by our own md_span /
// md_code_span nodes instead (see md-span-schema.ts) - real, always-editable
// nodes rather than marks whose delimiter syntax has to be faked in and out
// of existence around cursor movement. These bundles are the stock
// commonmark/gfm presets with just those four marks' schemas, input rules,
// keymaps, and toggle commands removed; everything else each preset
// provides (paragraphs, headings, lists, code blocks, tables, task lists,
// footnotes, links, images, ...) is untouched.
//
// $markSchema/$nodeSchema (and some other composable pieces) return
// array-like tuples that get spread apart by the presets' own internal
// `.flat()` calls - flattening this exclusion list the same way before
// building the lookup set is what makes `!==`-by-reference filtering below
// actually match the individual pieces sitting in `commonmark`/`gfm`.
const excludedCommonmarkPieces = [
  strongSchema,
  strongAttr,
  strongInputRule,
  strongKeymap,
  toggleStrongCommand,
  emphasisSchema,
  emphasisAttr,
  emphasisStarInputRule,
  emphasisUnderscoreInputRule,
  emphasisKeymap,
  toggleEmphasisCommand,
  inlineCodeSchema,
  inlineCodeAttr,
  inlineCodeInputRule,
  inlineCodeKeymap,
  toggleInlineCodeCommand,
].flat();

const excludedGfmPieces = [strikethroughSchema, strikethroughAttr, strikethroughInputRule, strikethroughKeymap, toggleStrikethroughCommand].flat();

const excludedCommonmarkSet = new Set<unknown>(excludedCommonmarkPieces);
const excludedGfmSet = new Set<unknown>(excludedGfmPieces);

export const commonmarkWithoutMarks = (commonmark as unknown[]).filter((piece) => !excludedCommonmarkSet.has(piece)) as typeof commonmark;
export const gfmWithoutStrikethrough = (gfm as unknown[]).filter((piece) => !excludedGfmSet.has(piece)) as typeof gfm;
