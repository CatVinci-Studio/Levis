import { useEffect, useRef, useState } from "react";
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

const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;

/**
 * A touch held still on a row: where it happened, so a menu can open
 * there. iOS fires no contextmenu event for a long press in a web view, so
 * this times the touch itself. The click that follows the finger lifting is
 * swallowed (consumeClick), or the row would also open the file.
 */
function useLongPress() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return {
    at,
    close: () => setAt(null),
    consumeClick: () => {
      const was = fired.current;
      fired.current = false;
      return was;
    },
    handlers: {
      onTouchStart: (e: React.TouchEvent) => {
        const touch = e.touches[0];
        start.current = { x: touch.clientX, y: touch.clientY };
        fired.current = false;
        cancel();
        timer.current = setTimeout(() => {
          fired.current = true;
          setAt(start.current);
        }, LONG_PRESS_MS);
      },
      onTouchMove: (e: React.TouchEvent) => {
        const touch = e.touches[0];
        const from = start.current;
        if (
          from &&
          Math.hypot(touch.clientX - from.x, touch.clientY - from.y) >
            LONG_PRESS_SLOP
        )
          cancel();
      },
      onTouchEnd: cancel,
      onTouchCancel: cancel,
    },
  };
}
