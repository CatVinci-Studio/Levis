/**
 * remark-math (the editor's math schema) and the chat panel's markdown
 * renderer only recognize `$...$` / `$$...$$` - never LaTeX's `\(...\)` /
 * `\[...\]`, which LLMs default to unless told otherwise (the system prompt,
 * AGENT_ROLE in src-tauri/src/ai/agent.rs, asks for `$`/`$$`, but this is a
 * backstop for replies - and pasted/typed/loaded content - that use the
 * backslash form anyway). Every path that turns markdown text into real
 * document content runs input through this first - see
 * src/editor/parse-markdown-source.ts for parserCtx-based paths and
 * MilkdownEditor.tsx for the file-load path, which sets defaultValueCtx
 * directly and so can't go through that shared helper.
 *
 * Skips fenced code blocks so literal `\(` in a code sample isn't touched.
 */
export function normalizeMathDelimiters(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/)
    .map((segment, i) =>
      i % 2 === 1
        ? segment
        : segment
            .replace(
              /\\\[([\s\S]*?)\\\]/g,
              (_, inner: string) => `$$${inner.trim()}$$`,
            )
            .replace(
              /\\\(([\s\S]*?)\\\)/g,
              (_, inner: string) => `$${inner.trim()}$`,
            ),
    )
    .join("");
}
