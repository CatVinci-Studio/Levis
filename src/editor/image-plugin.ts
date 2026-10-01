import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { convertFileSrc } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { dirname } from "../utils/path";
import { fs } from "../ipc";
import type { Settings, ImageNamingMode } from "../settings/SettingsContext";

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

function resolveImageSrc(src: string, docPath: string | null): string {
  // A Windows drive path ("C:\..." / "C:/...") would otherwise read as a
  // single-letter URL scheme to the test below.
  if (/^[a-z]:[\\/]/i.test(src)) return convertFileSrc(src);
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src)) return src; // http(s), data:, asset:, file:, ...
  if (src.startsWith("/")) return convertFileSrc(src);
  if (!docPath) return src;
  return convertFileSrc(`${dirname(docPath)}/${src}`);
}

const IMAGE_WIDTH_METADATA = /\s*\{levis-width=(\d{1,3})%\}\s*$/;

/** Store image width in a standard Markdown image title suffix. */
export function readImagePresentation(title: string | null | undefined): {
  title: string;
  widthPercent: number | null;
} {
  const value = title ?? "";
  const match = IMAGE_WIDTH_METADATA.exec(value);
  if (!match) return { title: value, widthPercent: null };

  const widthPercent = Number(match[1]);
  if (widthPercent < 1 || widthPercent > 100)
    return { title: value, widthPercent: null };
  return {
    title: value.slice(0, match.index).trimEnd(),
    widthPercent,
  };
}

export function writeImageWidth(
  title: string | null | undefined,
  widthPercent: number | null,
): string | null {
  const visibleTitle = readImagePresentation(title).title.trimEnd();
  if (widthPercent === null)
    return visibleTitle.length > 0 ? visibleTitle : null;

  const metadata = `{levis-width=${Math.min(100, Math.max(1, Math.round(widthPercent)))}%}`;
  return visibleTitle.length > 0 ? `${visibleTitle} ${metadata}` : metadata;
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

export function safeImageStem(name: string): string {
  const withoutExtension = name.replace(/\.[^.]*$/, "");
  return (
    Array.from(withoutExtension)
      .filter((character) => (character.codePointAt(0) ?? 0) >= 32)
      .join("")
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/[. ]+$/g, "")
      .trim() || "image"
  );
}

function automaticImageStem(): string {
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  const random = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `${stamp}-${random}`;
}

export function imageStemForMode(file: File, mode: ImageNamingMode): string {
  return mode === "auto" ? automaticImageStem() : safeImageStem(file.name);
}

async function saveAndInsertImages(
  view: EditorView,
  files: File[],
  docPath: string | null,
  settings: () => Settings,
  requestName: (stem: string, extension: string) => Promise<string | null>,
  onError: () => string,
): Promise<void> {
  for (const file of files) {
    const ext = EXT_BY_MIME[file.type];
    if (!ext) continue;
    try {
      const current = settings();
      const data = await fileToBase64(file);
      let src: string;
      if (current.imageStorageMode === "image-host") {
        if (!current.imageUploadEndpoint.trim())
          throw new Error("image host upload endpoint is not configured");
        let stem = imageStemForMode(file, current.imageNamingMode);
        if (current.imageNamingMode === "ask") {
          const chosen = await requestName(stem, ext);
          if (chosen === null) continue;
          stem = safeImageStem(chosen);
        }
        ({ src } = await fs.uploadImage(
          data,
          file.type,
          `${stem}.${ext}`,
          current.imageUploadEndpoint,
          current.imageUploadUrlField || "url",
        ));
      } else {
        ({ src } = await fs.savePastedImage(docPath, data, ext));
      }
      const image = view.state.schema.nodes.image;
      if (!image) return;
      view.dispatch(
        view.state.tr
          .replaceSelectionWith(image.create({ src }))
          .scrollIntoView(),
      );
    } catch (err) {
      console.error("saving pasted image failed:", err);
      void message(onError(), { kind: "error" });
    }
  }
}

/** A paragraph holding nothing but images (and line breaks between them):
 *  the "an image on its own line" case, laid out as a centred figure. */
function isImageParagraph(node: ProseNode): boolean {
  if (node.type.name !== "paragraph" || node.childCount === 0) return false;
  let images = 0;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type.name === "image") images++;
    else if (child.type.name !== "hardbreak") return false;
  }
  return images > 0;
}

function imageParagraphDecorations(doc: ProseNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (isImageParagraph(node))
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: "image-paragraph",
          }),
        );
      return false;
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

const imageParagraphKey = new PluginKey<DecorationSet>("image-paragraph");

/**
 * The image node view. Commonmark's image is an INLINE node, and it stays
 * one: rendering it as display:block (as this used to) put ProseMirror's
 * trailing caret line box underneath it - a phantom empty line after every
 * image, and a caret that painted in the wrong place. So the image renders
 * inline-block inside a wrapper, the way an inline node can actually
 * behave, and an image standing alone in its paragraph gets the centred
 * figure layout from that paragraph instead (image-paragraph above).
 *
 * The wrapper also carries the resize handle: dragging it sets the width as
 * a share of the paragraph, stored in the title suffix like the context
 * menu's presets (writeImageWidth), so the markdown stays standard.
 */
function createImageView(
  node: ProseNode,
  view: EditorView,
  getPos: () => number | undefined,
  docPath: () => string | null,
) {
  const dom = document.createElement("span");
  dom.className = "image-view";
  const img = document.createElement("img");
  const handle = document.createElement("span");
  handle.className = "image-resize-handle";
  handle.setAttribute("aria-hidden", "true");
  dom.append(img, handle);

  let current = node;
  const apply = (n: ProseNode) => {
    current = n;
    const presentation = readImagePresentation(n.attrs.title as string | null);
    const src = (n.attrs.src as string) ?? "";
    img.src = resolveImageSrc(src, docPath());
    // The markdown's own src, for exports: the rendered one is an asset:
    // URL that only resolves inside this app.
    img.dataset.docSrc = src;
    img.alt = (n.attrs.alt as string) ?? "";
    if (presentation.title) img.title = presentation.title;
    else img.removeAttribute("title");
    dom.style.width = presentation.widthPercent
      ? `${presentation.widthPercent}%`
      : "";
    dom.classList.toggle("image-view-sized", !!presentation.widthPercent);
  };
  apply(node);

  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const paragraph = dom.parentElement;
    if (!paragraph) return;
    const available = paragraph.clientWidth;
    const startWidth = dom.getBoundingClientRect().width;
    const startX = event.clientX;
    // A centred image grows from both sides, so the edge under the pointer
    // moves half as far as the width changes.
    const factor = paragraph.classList.contains("image-paragraph") ? 2 : 1;
    // Rendered px -> layout px: the editor content is zoomed with CSS zoom.
    const scale = startWidth / Math.max(1, dom.offsetWidth);
    let percent = (startWidth / scale / available) * 100;
    handle.setPointerCapture(event.pointerId);
    dom.classList.add("image-view-resizing");

    const move = (e: PointerEvent) => {
      const width = startWidth + (e.clientX - startX) * factor;
      percent = Math.min(100, Math.max(5, (width / scale / available) * 100));
      dom.style.width = `${percent}%`;
    };
    const finish = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      dom.classList.remove("image-view-resizing");
      const pos = getPos();
      if (pos === undefined) return;
      view.dispatch(
        view.state.tr.setNodeMarkup(pos, undefined, {
          ...current.attrs,
          title: writeImageWidth(
            current.attrs.title as string | null,
            Math.round(percent),
          ),
        }),
      );
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  });

  return {
    dom,
    update: (n: ProseNode) => {
      if (n.type.name !== "image") return false;
      apply(n);
      return true;
    },
    selectNode: () => dom.classList.add("ProseMirror-selectednode"),
    deselectNode: () => dom.classList.remove("ProseMirror-selectednode"),
    // The handle's drag is ours, not ProseMirror's (which would start a
    // node drag or move the selection).
    stopEvent: (event: Event) => event.target === handle,
    // Everything inside is written by this view - the live width while
    // resizing included - never by the user typing.
    ignoreMutation: () => true,
  };
}

export function createImagePlugin(options: {
  docPath: () => string | null;
  settings: () => Settings;
  requestName: (stem: string, extension: string) => Promise<string | null>;
  onError: () => string;
}) {
  return $prose(
    () =>
      new Plugin<DecorationSet>({
        key: imageParagraphKey,
        state: {
          init: (_config, state) => imageParagraphDecorations(state.doc),
          apply: (tr, previous) =>
            tr.docChanged ? imageParagraphDecorations(tr.doc) : previous,
        },
        props: {
          decorations: (state) => imageParagraphKey.getState(state),
          handlePaste(view, event) {
            const items = Array.from(event.clipboardData?.items ?? []);
            const files = items
              .filter(
                (item) =>
                  item.kind === "file" && item.type.startsWith("image/"),
              )
              .map((item) => item.getAsFile())
              .filter((f): f is File => f !== null);
            if (files.length === 0) return false;
            void saveAndInsertImages(
              view,
              files,
              options.docPath(),
              options.settings,
              options.requestName,
              options.onError,
            );
            return true;
          },
          nodeViews: {
            image: (node, view, getPos) =>
              createImageView(node, view, getPos, options.docPath),
          },
        },
      }),
  );
}
