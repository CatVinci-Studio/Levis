import { useCallback, useEffect, useState } from "react";
import { useSettings } from "../settings/SettingsContext";
import { ContextMenu, type ContextMenuItem } from "../editor/ContextMenu";
import { showConfirm, showMessage, showPrompt } from "../ui/app-dialog";
import { CloseIcon, GridViewIcon, ListViewIcon, MoreIcon } from "../ui/icons";
import { fs } from "../ipc";
import { getUiState, setUiState } from "../storage/ui-state";
import { basename, dirname } from "../utils/path";
import { useLongPress } from "../utils/useLongPress";
import {
  deleteIOSDocument,
  forgetIOSDocument,
  inIOSDocuments,
  iosFiles,
  recentIOSDocuments,
  renameIOSDocument,
} from "../platform/ios-files";
import "./DocumentList.css";

/**
 * The iPhone's list of documents: every document opened in Levis, newest
 * first (platform/ios-files.ts keeps the history). Tap one to open it; its
 * menu (the "..." button, or a long press) shares, renames, deletes or
 * forgets it. Documents in the app's own folder can be renamed and deleted;
 * one picked elsewhere in Files only granted access to the file itself, so
 * it can be opened, shared and dropped from the list.
 *
 * Laid out like the Files app: rows, or a grid of page thumbnails showing
 * each document's opening lines - the choice is remembered.
 */
interface Entry {
  path: string;
  local: boolean;
  /** Last modified; null for a picked file (no stat through its URL). */
  mtime: number | null;
  /** The opening lines as plain text, for the thumbnail. */
  preview: string;
}

type View = "list" | "grid";
function loadView(): View {
  return getUiState("documentListView") === "grid" ? "grid" : "list";
}

/** The first lines of a Markdown document with its syntax mostly gone -
 *  enough to recognise it by, not a rendering. */
export function previewText(markdown: string): string {
  return markdown
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .split("\n")
    .slice(0, 24)
    .map((line) =>
      line
        .replace(/^\s{0,3}((#{1,6}|>|[-*+]|\d+[.)])(\s+|$))+/, "")
        .replace(/(^|[^\\])[*_`~]+/g, "$1")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1"),
    )
    .join("\n")
    .trim()
    .slice(0, 600);
}

export interface DocumentListProps {
  activePath: string | null;
  onClose: () => void;
  onOpen: (path: string) => void;
  /** A document was renamed: open tabs follow it to its new path. */
  onRenamed: (from: string, to: string) => void;
  /** A document was deleted: an open tab keeps its text, unsaved. */
  onDeleted: (path: string) => void;
  /** Open a document from elsewhere in Files (the system picker). */
  onOpenOther: () => void;
}

export function DocumentList({
  activePath,
  onClose,
  onOpen,
  onRenamed,
  onDeleted,
  onOpenOther,
}: DocumentListProps) {
  const { t, settings } = useSettings();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [view, setView] = useState<View>(loadView);

  const reload = useCallback(async () => {
    const paths = await recentIOSDocuments();
    setEntries(
      await Promise.all(
        paths.map(async (path) => ({
          path,
          local: await inIOSDocuments(path),
          mtime: await fs.fileMtimeMs(path).catch(() => null),
          preview: previewText(await fs.readTextFile(path).catch(() => "")),
        })),
      ),
    );
  }, []);

  function switchView(next: View) {
    setView(next);
    setUiState("documentListView", next);
  }

  const dateFormat = new Intl.DateTimeFormat(settings.language, {
    dateStyle: "medium",
  });
  const timeFormat = new Intl.DateTimeFormat(settings.language, {
    timeStyle: "short",
  });
  const when = (mtime: number | null) => {
    if (mtime === null) return "";
    const d = new Date(mtime);
    return d.toDateString() === new Date().toDateString()
      ? timeFormat.format(d)
      : dateFormat.format(d);
  };

  useEffect(() => {
    void reload();
  }, [reload]);

  const fail = (error: unknown) =>
    showMessage(String(error), { title: t.docActionFailed, tone: "error" });

  async function rename(entry: Entry) {
    const name = await showPrompt(t.docRenamePrompt, basename(entry.path), {
      title: t.docRename,
      okLabel: t.docRenameOk,
      cancelLabel: t.closePromptCancel,
    });
    if (!name || name === basename(entry.path)) return;
    try {
      const to = await renameIOSDocument(entry.path, name);
      onRenamed(entry.path, to);
      await reload();
    } catch (error) {
      await fail(error);
    }
  }

  async function remove(entry: Entry) {
    const ok = await showConfirm(
      t.docDeleteConfirm.replace("{name}", basename(entry.path)),
      {
        title: t.docDelete,
        tone: "warning",
        okLabel: t.docDeleteOk,
        cancelLabel: t.closePromptCancel,
        danger: true,
      },
    );
    if (!ok) return;
    try {
      await deleteIOSDocument(entry.path);
      onDeleted(entry.path);
      await reload();
    } catch (error) {
      await fail(error);
    }
  }

  function actions(entry: Entry): ContextMenuItem[] {
    return [
      { label: t.treeOpen, onSelect: () => onOpen(entry.path) },
      {
        label: t.menuShare,
        onSelect: () => void iosFiles.share(entry.path).catch(fail),
      },
      ...(entry.local
        ? [
            { label: t.docRename, onSelect: () => void rename(entry) },
            {
              label: t.docDelete,
              danger: true,
              onSelect: () => void remove(entry),
            },
          ]
        : [
            {
              label: t.docForget,
              onSelect: () => void forgetIOSDocument(entry.path).then(reload),
            },
          ]),
    ];
  }

  return (
    <div className="document-list" role="dialog" aria-label={t.docListTitle}>
      <header className="document-list-header">
        <button
          type="button"
          className="document-list-icon-button"
          aria-label={t.docListClose}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
        <h2>{t.docListTitle}</h2>
        <button
          type="button"
          className="document-list-text-button"
          onClick={onOpenOther}
        >
          {t.docListOpenOther}
        </button>
      </header>
      <div className="document-list-toolbar">
        <span className="document-list-count">
          {entries && entries.length > 0
            ? entries.length === 1
              ? t.docCountOne
              : t.docCount.replace("{n}", String(entries.length))
            : ""}
        </span>
        <div className="document-list-views" role="radiogroup">
          {(
            [
              ["list", t.docViewList, <ListViewIcon key="l" />],
              ["grid", t.docViewGrid, <GridViewIcon key="g" />],
            ] as const
          ).map(([v, label, icon]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              aria-label={label}
              className="document-list-view-button"
              onClick={() => switchView(v)}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>
      <div className={`document-list-body document-list-${view}`}>
        {entries !== null && entries.length === 0 && (
          <p className="document-list-empty">{t.docListEmpty}</p>
        )}
        {entries?.map((entry) => (
          <DocumentItem
            key={entry.path}
            view={view}
            entry={entry}
            active={entry.path === activePath}
            detail={[
              when(entry.mtime),
              entry.local ? "Levis" : basename(dirname(entry.path)),
            ]
              .filter(Boolean)
              .join(" · ")}
            date={when(entry.mtime)}
            onOpen={() => onOpen(entry.path)}
            actions={() => actions(entry)}
            moreLabel={t.docMore}
          />
        ))}
      </div>
    </div>
  );
}

function DocumentItem({
  view,
  entry,
  active,
  detail,
  date,
  onOpen,
  actions,
  moreLabel,
}: {
  view: View;
  entry: Entry;
  active: boolean;
  /** Date and location, for a row. */
  detail: string;
  /** Date alone, under a thumbnail. */
  date: string;
  onOpen: () => void;
  actions: () => ContextMenuItem[];
  moreLabel: string;
}) {
  const press = useLongPress();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const at = menuAt ?? press.at;
  const name = basename(entry.path);
  const page = (
    <span className="document-page" aria-hidden>
      <span className="document-page-text">{entry.preview}</span>
    </span>
  );
  return (
    <div
      className={`document-item document-item-${view}${active ? " document-item-active" : ""}`}
    >
      <button
        type="button"
        className="document-item-main"
        onClick={() => {
          if (!press.consumeClick()) onOpen();
        }}
        {...press.handlers}
      >
        {page}
        <span className="document-item-text">
          <span className="document-item-name">{name}</span>
          <span className="document-item-detail">
            {view === "grid" ? date : detail}
          </span>
        </span>
      </button>
      {view === "list" && (
        <button
          type="button"
          className="document-list-icon-button"
          aria-label={moreLabel}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt({ x: r.left, y: r.bottom });
          }}
        >
          <MoreIcon />
        </button>
      )}
      {at && (
        <ContextMenu
          x={at.x}
          y={at.y}
          title={name}
          items={actions()}
          onClose={() => {
            setMenuAt(null);
            press.close();
          }}
        />
      )}
    </div>
  );
}
