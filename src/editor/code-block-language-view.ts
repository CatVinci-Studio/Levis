import { $view } from "@milkdown/kit/utils";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";

// A curated common subset rather than refractor's full ~40-language list -
// enough to cover what people actually fence code with, in a menu that
// still fits on screen.
const LANGUAGES = [
  "",
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "python",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "csharp",
  "ruby",
  "php",
  "swift",
  "kotlin",
  "bash",
  "json",
  "yaml",
  "toml",
  "sql",
  "html",
  "css",
  "scss",
  "markdown",
  "diff",
];

/**
 * Code blocks otherwise render via codeBlockSchema's plain toDOM (a bare
 * <pre><code>), which has no way to change the fence's language after the
 * fact. This NodeView wraps that same <pre><code> (still the real
 * contentDOM, so typing/highlighting decorations work exactly as before)
 * with a small language-select header above it.
 */
export const codeBlockLanguageView = $view(codeBlockSchema.node, () => (node, view, getPos) => {
  const wrapper = document.createElement("div");
  wrapper.className = "code-block-wrapper";

  const header = document.createElement("div");
  header.className = "code-block-header";
  header.contentEditable = "false";

  const select = document.createElement("select");
  select.className = "code-block-language-select";
  for (const lang of LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = lang;
    opt.textContent = lang === "" ? "plain text" : lang;
    select.appendChild(opt);
  }

  function syncSelectValue(currentNode: typeof node) {
    const lang = (currentNode.attrs.language as string) ?? "";
    select.value = LANGUAGES.includes(lang) ? lang : "";
  }
  syncSelectValue(node);

  select.addEventListener("mousedown", (e) => e.stopPropagation());
  select.addEventListener("change", () => {
    const pos = getPos();
    if (pos == null) return;
    const tr = view.state.tr.setNodeMarkup(pos, undefined, { language: select.value });
    view.dispatch(tr);
    view.focus();
  });

  header.appendChild(select);

  const pre = document.createElement("pre");
  const code = document.createElement("code");
  pre.appendChild(code);

  wrapper.appendChild(header);
  wrapper.appendChild(pre);

  return {
    dom: wrapper,
    contentDOM: code,
    update(updatedNode) {
      if (updatedNode.type !== node.type) return false;
      syncSelectValue(updatedNode);
      return true;
    },
  };
});
