import type { Editor } from "@milkdown/kit/core";
import { history } from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { listener } from "@milkdown/kit/plugin/listener";
import { $remark } from "@milkdown/kit/utils";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkCjkFriendlyGfmStrikethrough from "remark-cjk-friendly-gfm-strikethrough";
import {
  commonmarkWithoutMarks,
  gfmWithoutStrikethrough,
} from "./reduced-presets";
import {
  remarkFrontmatterPlugin,
  frontmatterSchema,
} from "./frontmatter-schema";
import { createGithubAlertPlugin } from "./github-alert-plugin";
import { rawHtmlSchema } from "./raw-html-schema";
import { createRawHtmlPreviewPlugin } from "./raw-html-preview-plugin";
import { brToHardbreakPlugin } from "./br-hardbreak-plugin";
import {
  remarkHighlightPlugin,
  mdSpanSchema,
  mdCodeSpanSchema,
} from "./md-span-schema";
import { mdSpanAutopairPlugin } from "./md-span-autopair-plugin";
import { formatShortcutPlugin } from "./format-shortcut-plugin";
import { enclosurePlugin } from "./enclosure";
import {
  remarkMathPlugin,
  mathInlineSchema,
  mathBlockSchema,
  mathInlineInputRule,
} from "./math-schema";
import { mathAutopairPlugin } from "./math-autopair-plugin";
import { createMathPreviewPlugin } from "./math-preview-plugin";
import { headingMarkerPlugin } from "./heading-marker-plugin";
import { taskListClickPlugin } from "./task-list-plugin";
import { syntaxHighlightPlugin } from "./syntax-highlight-plugin";
import { codeBlockLanguageView } from "./code-block-language-view";
import { tableHoverView } from "./table-hover-view";
import { createMermaidPreviewPlugin } from "./mermaid-plugin";
import { tabExtendPlugin } from "./tab-extend-plugin";
import { escapeTrailingBlockPlugin } from "./escape-trailing-block-plugin";
import { pasteMarkdownSourcePlugin } from "./paste-markdown-plugin";
import { clipboardHistoryPlugin } from "./clipboard-history-plugin";
import { createImagePlugin } from "./image-plugin";
import { createTypewriterPlugin } from "./typewriter-plugin";
import { createPlaceholderPlugin } from "./placeholder-plugin";
import { createGhostTextPlugin } from "../ai/ghost-text-plugin";
import { buildCompletionStyle } from "../ai/completion-style";
import { createGrammarCheckPlugin } from "../ai/grammar-check-plugin";
import {
  createPendingEditPlugin,
  type PendingPreview,
} from "../ai/pending-edit-plugin";
import { chatSelectionPlugin } from "../ai/chat-selection-plugin";
import { findReplacePlugin } from "./find-replace-plugin";
import { strings } from "../i18n/strings";
import type { Settings } from "../settings/SettingsContext";

export interface PendingEditCallbacks {
  onAccept: (callId: string) => void;
  onReject: (callId: string) => void;
  onPreviewsChange: (previews: PendingPreview[]) => void;
}

/**
 * The complete feature set the editor is composed of, in load order.
 * `settings` is a live ref (see useLatest) because the chain is built once
 * at mount while several features (AI, math, mermaid, typewriter,
 * placeholder language) follow the current Settings values. `pendingEdits`
 * is similarly built once - its callbacks must be stable, ref-indirected
 * wrappers (see MilkdownEditor) since usePendingEdits itself is created
 * from a `run` that isn't ready yet at this point.
 */
export function withEditorExtensions(
  editor: Editor,
  settings: { readonly current: Settings },
  docPath: { readonly current: string | null },
  pendingEdits: PendingEditCallbacks,
  /** True while the onboarding tour runs: the typing-triggered AI plugins
   *  go quiet so the tour's PRE-WRITTEN suggestions (utils/events.ts's
   *  TUTORIAL_MOCK_GHOST_EVENT) are the only AI-looking thing on screen -
   *  first-run users have no account, and a real response arriving over a
   *  mocked one would derail the script. */
  aiMuted: { readonly current: boolean },
  /** A pasted image failed to save to disk - the message to show in a
   *  native alert (localized, since this plugin has no i18n access itself). */
  onImagePasteError: () => string,
): Editor {
  return (
    editor
      // Markdown baseline: commonmark/GFM with bold/italic/strike marks
      // stripped - those are node-based below.
      .use(commonmarkWithoutMarks)
      .use(gfmWithoutStrikethrough)

      // Leading "---\n...\n---" block, parsed before anything else gets a
      // chance to misread its "---" lines as setext headings.
      .use(remarkFrontmatterPlugin)
      .use(frontmatterSchema)

      // Raw HTML: parses to real text (replacing stock htmlSchema, excluded
      // in reduced-presets.ts) so it stays editable; a whitelist of common
      // tags renders while the cursor is elsewhere.
      .use(rawHtmlSchema)
      .use(createRawHtmlPreviewPlugin())
      .use(brToHardbreakPlugin)

      // GitHub-style alerts: > [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING]
      // / [!CAUTION] blockquotes render as colored callouts with a badge.
      .use(createGithubAlertPlugin())

      // CommonMark's emphasis flanking rules reject "**" next to CJK
      // punctuation (e.g. 话说**“你好”**了 stays literal), which would also
      // break reopening files whose bold was created here. This relaxes the
      // rules for CJK - parse side only; serialization is unchanged.
      .use($remark("remark-cjk-friendly", () => remarkCjkFriendly))
      .use(
        $remark(
          "remark-cjk-friendly-gfm-strikethrough",
          () => remarkCjkFriendlyGfmStrikethrough,
        ),
      )

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
      .use(
        createMathPreviewPlugin({ enabled: () => settings.current.enableMath }),
      )

      // Block-level niceties.
      .use(headingMarkerPlugin)
      .use(taskListClickPlugin)
      .use(syntaxHighlightPlugin)
      .use(codeBlockLanguageView)
      .use(tableHoverView)
      .use(
        createMermaidPreviewPlugin({
          enabled: () => settings.current.enableMermaid,
        }),
      )

      // Editing infrastructure. handlePaste props run in registration
      // order: images (binary, most specific) first, then markdown-source
      // text, then milkdown's own clipboard plugin.
      .use(history)
      .use(
        createImagePlugin({
          docPath: () => docPath.current,
          onError: onImagePasteError,
        }),
      )
      .use(pasteMarkdownSourcePlugin)
      .use(clipboard)
      .use(clipboardHistoryPlugin)
      .use(listener)
      .use(tabExtendPlugin)
      .use(escapeTrailingBlockPlugin)
      .use(findReplacePlugin)
      .use(
        createTypewriterPlugin({
          enabled: () => settings.current.typewriterMode,
        }),
      )
      .use(
        createPlaceholderPlugin(
          () => strings[settings.current.language].emptyDocPlaceholder,
        ),
      )

      // AI assistance (each independently toggleable in Settings).
      .use(
        createGhostTextPlugin({
          enabled: () => settings.current.enableCompletion && !aiMuted.current,
          provider: () => settings.current.aiProvider,
          model: () =>
            settings.current.writingModels[settings.current.aiProvider] || null,
          style: () => buildCompletionStyle(settings.current.completionTone),
        }),
      )
      .use(
        createGrammarCheckPlugin({
          enabled: () =>
            settings.current.enableGrammarCheck && !aiMuted.current,
          provider: () => settings.current.aiProvider,
          model: () =>
            settings.current.writingModels[settings.current.aiProvider] || null,
          strictness: () => settings.current.grammarStrictness,
        }),
      )
      .use(
        createPendingEditPlugin({
          ...pendingEdits,
          animationEnabled: () => settings.current.enableEditAnimation,
        }),
      )
      .use(chatSelectionPlugin)
  );
}
