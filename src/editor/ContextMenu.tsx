import type { CSSProperties } from "react";
import { useCloseOnOutsideClick } from "../utils/useCloseOnOutsideClick";
import { useViewportClamp } from "../utils/useViewportClamp";
import { ActionSheet } from "../mobile/ActionSheet";
import { usePhoneLayout } from "../mobile/usePhoneLayout";
import { usePresenceProps, usePresenceState } from "../ui/usePresence";
import "./ContextMenu.css";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: (ContextMenuItem | "separator")[];
  onClose: () => void;
  /** Heads the phone's action sheet (a file's name, say); unused by the
   *  menu at the pointer, which shows where it was opened. */
  title?: string;
}

/** A menu at the pointer - or, on a phone, the same items as an action
 *  sheet from the bottom edge (mobile/ActionSheet.tsx). Render it inside a
 *  Presence (ui/usePresence.ts) for its exit. */
export function ContextMenu(props: ContextMenuProps) {
  const phone = usePhoneLayout();
  if (phone)
    return (
      <ActionSheet
        title={props.title}
        items={props.items}
        onClose={props.onClose}
      />
    );
  return <PointerMenu {...props} />;
}

function PointerMenu({ x, y, items, onClose }: ContextMenuProps) {
  // On its way out it no longer answers Escape: the next press belongs to
  // whatever is under it (the find bar, a dialog).
  const open = usePresenceState() === "open";
  const ref = useCloseOnOutsideClick<HTMLDivElement>(onClose, true, open);
  const pos = useViewportClamp(ref, x, y);
  const presence = usePresenceProps(ref);
  // It grows out of the point that was clicked - a corner, unless the menu
  // was pulled back from a window edge.
  const origin = {
    "--transform-origin": `${Math.max(0, x - pos.left)}px ${Math.max(0, y - pos.top)}px`,
  } as CSSProperties;

  return (
    <div
      {...presence}
      className="context-menu floating-surface"
      style={{ ...pos, ...origin }}
    >
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={i} className="context-menu-separator" />
        ) : (
          <button
            key={i}
            className={`context-menu-item ${item.danger ? "context-menu-item-danger" : ""}`}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
