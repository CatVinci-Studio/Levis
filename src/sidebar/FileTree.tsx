import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DirEntryInfo } from "./types";
import { ChevronIcon, FolderIcon, FolderOpenIcon, fileIconFor } from "./icons";
import "./FileTree.css";

interface FileTreeProps {
  rootPath: string;
  activePath: string | null;
  onFileSelect: (path: string) => void;
}

export function FileTree({ rootPath, activePath, onFileSelect }: FileTreeProps) {
  return (
    <div className="file-tree">
      <DirNode path={rootPath} depth={0} activePath={activePath} onFileSelect={onFileSelect} forceOpen />
    </div>
  );
}

interface DirNodeProps {
  path: string;
  depth: number;
  activePath: string | null;
  onFileSelect: (path: string) => void;
  forceOpen?: boolean;
}

function DirNode({ path, depth, activePath, onFileSelect, forceOpen }: DirNodeProps) {
  const [open, setOpen] = useState(!!forceOpen);
  const [children, setChildren] = useState<DirEntryInfo[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function ensureLoaded() {
    if (children !== null || loading) return;
    setLoading(true);
    try {
      const entries = await invoke<DirEntryInfo[]>("list_dir", { path });
      setChildren(entries);
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) await ensureLoaded();
  }

  // Root node loads immediately since it starts open.
  if (forceOpen && children === null && !loading) {
    void ensureLoaded();
  }

  return (
    <div className="dir-node">
      {depth > 0 && (
        <button className="tree-row" style={{ paddingLeft: depth * 14 }} onClick={toggle}>
          <ChevronIcon className={`chevron ${open ? "chevron-open" : ""}`} />
          {open ? <FolderOpenIcon className="tree-icon" /> : <FolderIcon className="tree-icon" />}
          <span className="tree-label">{path.split("/").pop()}</span>
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
  const Icon = fileIconFor(entry.name);
  return (
    <button
      className={`tree-row ${active ? "tree-row-active" : ""}`}
      style={{ paddingLeft: depth * 14 + 12 }}
      onClick={() => onSelect(entry.path)}
    >
      <Icon className="tree-icon" />
      <span className="tree-label">{entry.name}</span>
    </button>
  );
}
