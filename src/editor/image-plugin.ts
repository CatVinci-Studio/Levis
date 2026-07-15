import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

/**
 * Image support, Typora-style, in two halves:
 *
 * - PASTE: a bitmap on the clipboard (screenshot, copied image) is written
 *   to an `assets/` folder next to the current document by the
 *   save_pasted_image command, and an image node with the relative
 *   "assets/<name>" src is inserted - so the markdown stays portable.
 *   Unsaved drafts have no folder yet; their images land in the app data
 *   dir with an absolute src instead.
 *
 * - RENDER: the webview can't load local files directly, so a nodeView
 *   rewrites local srcs through Tauri's asset protocol at display time -
 *   relative paths resolved against the document's folder. The document
 *   itself keeps the original src; only the <img> element sees the
 *   asset: URL.
 */

function dirname(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx > 0 ? path.slice(0, idx) : path;
}

function resolveImageSrc(src: string, docPath: string | null): string {
  // A Windows drive path ("C:\..." / "C:/...") would otherwise read as a
  // single-letter URL scheme to the test below.
  if (/^[a-z]:[\\/]/i.test(src)) return convertFileSrc(src);
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src)) return src; // http(s), data:, asset:, file:, ...
  if (src.startsWith("/")) return convertFileSrc(src);
  if (!docPath) return src;
  return convertFileSrc(`${dirname(docPath)}/${src}`);
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function saveAndInsertImages(view: EditorView, files: File[], docPath: string | null): Promise<void> {
  for (const file of files) {
    const ext = EXT_BY_MIME[file.type];
    if (!ext) continue;
    try {
      const { src } = await invoke<{ src: string }>("save_pasted_image", {
        docPath,
        dataBase64: await fileToBase64(file),
        ext,
      });
      const image = view.state.schema.nodes.image;
      if (!image) return;
      view.dispatch(view.state.tr.replaceSelectionWith(image.create({ src })).scrollIntoView());
    } catch (err) {
      console.error("saving pasted image failed:", err);
    }
  }
}

export function createImagePlugin(options: { docPath: () => string | null }) {
  return $prose(
    () =>
      new Plugin({
        props: {
          handlePaste(view, event) {
            const items = Array.from(event.clipboardData?.items ?? []);
            const files = items
              .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
              .map((item) => item.getAsFile())
              .filter((f): f is File => f !== null);
            if (files.length === 0) return false;
            void saveAndInsertImages(view, files, options.docPath());
            return true;
          },
          nodeViews: {
            image: (node: ProseNode) => {
              const img = document.createElement("img");
              const apply = (n: ProseNode) => {
                img.src = resolveImageSrc((n.attrs.src as string) ?? "", options.docPath());
                img.alt = (n.attrs.alt as string) ?? "";
                if (n.attrs.title) img.title = n.attrs.title as string;
              };
              apply(node);
              return {
                dom: img,
                update: (n: ProseNode) => {
                  if (n.type.name !== "image") return false;
                  apply(n);
                  return true;
                },
              };
            },
          },
        },
      }),
  );
}
