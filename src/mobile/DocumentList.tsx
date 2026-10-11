import { useCallback, useEffect, useState } from "react";
import { useSettings } from "../settings/SettingsContext";
import { ContextMenu, type ContextMenuItem } from "../editor/ContextMenu";
import { showConfirm, showMessage, showPrompt } from "../ui/app-dialog";
import { CloseIcon, MoreIcon } from "../ui/icons";
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
 */
interface Entry {
  path: string;
  local: boolean;
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
  const { t } = useSettings();
  const [entries, setEntries] = useState<Entry[] | null>(null);

  const reload = useCallback(async () => {
    const paths = await recentIOSDocuments();
    setEntries(
      await Promise.all(
        paths.map(async (path) => ({
          path,
          local: await inIOSDocuments(path),
        })),
      ),
    );
  }, []);

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
      <div className="document-list-body">
        {entries !== null && entries.length === 0 && (
          <p className="document-list-empty">{t.docListEmpty}</p>
        )}
        {entries?.map((entry) => (
          <DocumentRow
            key={entry.path}
            entry={entry}
            active={entry.path === activePath}
            location={entry.local ? "Levis" : basename(dirname(entry.path))}
            onOpen={() => onOpen(entry.path)}
            actions={() => actions(entry)}
            moreLabel={t.docMore}
          />
        ))}
      </div>
    </div>
  );
}

function DocumentRow({
  entry,
  active,
  location,
  onOpen,
  actions,
  moreLabel,
}: {
  entry: Entry;
  active: boolean;
  location: string;
  onOpen: () => void;
  actions: () => ContextMenuItem[];
  moreLabel: string;
}) {
  const press = useLongPress();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const at = menuAt ?? press.at;
  return (
    <div className={`document-row${active ? " document-row-active" : ""}`}>
      <button
        type="button"
        className="document-row-main"
        onClick={() => {
          if (!press.consumeClick()) onOpen();
        }}
        {...press.handlers}
      >
        <span className="document-row-name">{basename(entry.path)}</span>
        <span className="document-row-location">{location}</span>
      </button>
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
      {at && (
        <ContextMenu
          x={at.x}
          y={at.y}
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
