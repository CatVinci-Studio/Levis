import { useEffect, useState } from "react";
import type { DirEntryInfo } from "./types";
import {
  ArrowUpIcon,
  ChevronIcon,
  FolderIcon,
  FolderOpenIcon,
  RefreshIcon,
  fileIconFor,
} from "../ui/icons";
import { fs } from "../ipc";
import { useSettings } from "../settings/SettingsContext";
import { basename, isInside, parentDir } from "../utils/path";
import { isIOSApp } from "../platform/capabilities";
import { iosFiles } from "../platform/ios-files";
import { ContextMenu } from "../editor/ContextMenu";
import { useLongPress } from "../utils/useLongPress";
import "./FileTree.css";

interface FileTreeProps {
  /** The active document's folder: where the tree starts. The caller keys
   *  the tree on it, so switching to a document elsewhere starts over. */
  rootPath: string;
  activePath: string | null;
  onFileSelect: (path: string) => void;
}

export function FileTree({
  rootPath,
  activePath,
  onFileSelect,
}: FileTreeProps) {
  const { t } = useSettings();
  // Where the tree is rooted right now; "up" walks it toward the filesystem
  // root without touching the open document.
  const [root, setRoot] = useState(rootPath);
  // Bumped by Refresh: remounts every node so each re-reads its folder.
  const [generation, setGeneration] = useState(0);
  // Not on iOS: above Documents is the app's private container, and above
  // a folder picked in Files is outside what the user granted.
  const parent = isIOSApp ? null : parentDir(root);

  return (
    <div className="file-tree">
      <div className="tree-toolbar">
        {!isIOSApp && (
          <button
            className="tree-tool"
            onClick={() => parent && setRoot(parent)}
            disabled={!parent}
            title={t.treeParentFolder}
            aria-label={t.treeParentFolder}
          >
            <ArrowUpIcon />
          </button>
        )}
        <span className="tree-root-label" title={root}>
          {basename(root.replace(/[\\/]+$/, "")) || root}
        </span>
        <button
          className="tree-tool"
          onClick={() => setGeneration((g) => g + 1)}
          title={t.treeRefresh}
          aria-label={t.treeRefresh}
        >
          <RefreshIcon />
        </button>
      </div>
      <DirNode
        key={`${root}\n${generation}`}
        path={root}
        depth={0}
        activePath={activePath}
        onFileSelect={onFileSelect}
        onEnter={setRoot}
      />
    </div>
  );
}

interface DirNodeProps {
  path: string;
  depth: number;
  activePath: string | null;
  onFileSelect: (path: string) => void;
  /** Re-roots the tree at a folder (double-click on its row). */
  onEnter: (path: string) => void;
}

function DirNode({
  path,
  depth,
  activePath,
  onFileSelect,
  onEnter,
}: DirNodeProps) {
  // The root is always open; a folder on the way down to the open document
  // starts open too, so walking "up" still shows where that document is.
  const [open, setOpen] = useState(
    depth === 0 || (activePath !== null && isInside(activePath, path)),
  );
  const [children, setChildren] = useState<DirEntryInfo[] | null>(null);

  useEffect(() => {
    if (!open || children !== null) return;
    let cancelled = false;
    fs.listDir(path).then(
      (entries) => !cancelled && setChildren(entries),
      // Unreadable (permissions, vanished): show it empty rather than retry.
      () => !cancelled && setChildren([]),
    );
    return () => {
      cancelled = true;
    };
  }, [open, children, path]);

  return (
    <div className="dir-node">
      {depth > 0 && (
        <button
          className="tree-row"
          style={{ paddingLeft: depth * 14 }}
          onClick={() => setOpen(!open)}
          onDoubleClick={() => onEnter(path)}
        >
          <ChevronIcon className={`chevron ${open ? "chevron-open" : ""}`} />
          {open ? (
            <FolderOpenIcon className="tree-icon" />
          ) : (
            <FolderIcon className="tree-icon" />
          )}
          <span className="tree-label">{basename(path)}</span>
        </button>
      )}
      {open && children && (
        <div className="dir-children">
          {children.map((entry) =>
            entry.is_dir ? (
              <DirNode
                key={entry.path}
                path={entry.path}
                depth={depth + 1}
                activePath={activePath}
                onFileSelect={onFileSelect}
                onEnter={onEnter}
              />
            ) : (
              <FileNode
                key={entry.path}
                entry={entry}
                depth={depth + 1}
                active={entry.path === activePath}
                onSelect={onFileSelect}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function FileNode({
  entry,
  depth,
  active,
  onSelect,
}: {
  entry: DirEntryInfo;
  depth: number;
  active: boolean;
  onSelect: (path: string) => void;
}) {
  const { t } = useSettings();
  const Icon = fileIconFor(entry.name);
  const press = useLongPress();
  return (
    <>
      <button
        className={`tree-row ${active ? "tree-row-active" : ""}`}
        style={{ paddingLeft: depth * 14 + 12 }}
        onClick={() => {
          if (!press.consumeClick()) onSelect(entry.path);
        }}
        {...(isIOSApp ? press.handlers : {})}
      >
        <Icon className="tree-icon" />
        <span className="tree-label">{entry.name}</span>
      </button>
      {press.at && (
        <ContextMenu
          x={press.at.x}
          y={press.at.y}
          title={entry.name}
          onClose={press.close}
          items={[
            { label: t.treeOpen, onSelect: () => onSelect(entry.path) },
            {
              label: t.menuShare,
              onSelect: () => void iosFiles.share(entry.path).catch(() => {}),
            },
          ]}
        />
      )}
    </>
  );
}
