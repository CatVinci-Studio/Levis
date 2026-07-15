/**
 * LLMs default to LaTeX's `\(...\)` / `\[...\]` delimiters unless told
 * otherwise. The system prompt (AGENT_ROLE in src-tauri/src/ai/agent.rs)
 * asks for `$...$` / `$$...$$` instead - remark-math (the editor's math
 * schema) and the chat panel's markdown renderer only recognize those - but
 * this is a backstop for replies that ignore the instruction anyway.
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
            .replace(/\\\[([\s\S]*?)\\\]/g, (_, inner: string) => `$$${inner.trim()}$$`)
            .replace(/\\\(([\s\S]*?)\\\)/g, (_, inner: string) => `$${inner.trim()}$`),
    )
    .join("");
}
