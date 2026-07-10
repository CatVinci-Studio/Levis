import type { Editor } from "@milkdown/kit/core";
import { history } from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { listener } from "@milkdown/kit/plugin/listener";
import { commonmarkWithoutMarks, gfmWithoutStrikethrough } from "./reduced-presets";
import { remarkHighlightPlugin, mdSpanSchema, mdCodeSpanSchema } from "./md-span-schema";
import { mdSpanAutopairPlugin } from "./md-span-autopair-plugin";
import { formatShortcutPlugin } from "./format-shortcut-plugin";
import { enclosurePlugin } from "./enclosure";
import { remarkMathPlugin, mathInlineSchema, mathBlockSchema, mathInlineInputRule } from "./math-schema";
import { mathAutopairPlugin } from "./math-autopair-plugin";
import { createMathPreviewPlugin } from "./math-preview-plugin";
import { headingMarkerPlugin } from "./heading-marker-plugin";
import { taskListClickPlugin } from "./task-list-plugin";
import { syntaxHighlightPlugin } from "./syntax-highlight-plugin";
import { codeBlockLanguageView } from "./code-block-language-view";
import { createMermaidPreviewPlugin } from "./mermaid-plugin";
import { tabExtendPlugin } from "./tab-extend-plugin";
import { escapeTrailingBlockPlugin } from "./escape-trailing-block-plugin";
import { pasteMarkdownSourcePlugin } from "./paste-markdown-plugin";
import { createImagePlugin } from "./image-plugin";
import { createTypewriterPlugin } from "./typewriter-plugin";
import { createPlaceholderPlugin } from "./placeholder-plugin";
import { createGhostTextPlugin } from "../ai/ghost-text-plugin";
import { createGrammarCheckPlugin } from "../ai/grammar-check-plugin";
import { strings } from "../i18n/strings";
import type { Settings } from "../settings/SettingsContext";

/**
 * The complete feature set the editor is composed of, in load order.
 * `settings` is a live ref (see useLatest) because the chain is built once
 * at mount while several features (AI, math, mermaid, typewriter,
 * placeholder language) follow the current Settings values.
 */
export function withEditorExtensions(
  editor: Editor,
  settings: { readonly current: Settings },
  docPath: { readonly current: string | null },
): Editor {
  return (
    editor
      // Markdown baseline: commonmark/GFM with bold/italic/strike marks
      // stripped - those are node-based below.
      .use(commonmarkWithoutMarks)
      .use(gfmWithoutStrikethrough)

      // Inline enclosures: bold/italic/strikethrough/highlight/inline code
      // as real nodes with synthesized, Typora-style delimiters.
      .use(remarkHighlightPlugin)
      .use(mdSpanSchema)
      .use(mdCodeSpanSchema)
      .use(mdSpanAutopairPlugin)
      .use(formatShortcutPlugin)
      .use(enclosurePlugin)

      // Math: $/$$ enclosures sharing the same model, plus KaTeX rendering.
      .use(remarkMathPlugin)
      .use(mathInlineSchema)
      .use(mathBlockSchema)
      .use(mathInlineInputRule)
      .use(mathAutopairPlugin)
      .use(createMathPreviewPlugin({ enabled: () => settings.current.enableMath }))

      // Block-level niceties.
      .use(headingMarkerPlugin)
      .use(taskListClickPlugin)
      .use(syntaxHighlightPlugin)
      .use(codeBlockLanguageView)
      .use(createMermaidPreviewPlugin({ enabled: () => settings.current.enableMermaid }))

      // Editing infrastructure. handlePaste props run in registration
      // order: images (binary, most specific) first, then markdown-source
      // text, then milkdown's own clipboard plugin.
      .use(history)
      .use(createImagePlugin({ docPath: () => docPath.current }))
      .use(pasteMarkdownSourcePlugin)
      .use(clipboard)
      .use(listener)
      .use(tabExtendPlugin)
      .use(escapeTrailingBlockPlugin)
      .use(createTypewriterPlugin({ enabled: () => settings.current.typewriterMode }))
      .use(createPlaceholderPlugin(() => strings[settings.current.language].emptyDocPlaceholder))

      // AI assistance (each independently toggleable in Settings).
      .use(
        createGhostTextPlugin({
          enabled: () => settings.current.enableCompletion,
          provider: () => settings.current.aiProvider,
        }),
      )
      .use(
        createGrammarCheckPlugin({
          enabled: () => settings.current.enableGrammarCheck,
          provider: () => settings.current.aiProvider,
        }),
      )
  );
}
