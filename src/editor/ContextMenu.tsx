import { useCloseOnOutsideClick } from "../utils/useCloseOnOutsideClick";
import { useViewportClamp } from "../utils/useViewportClamp";
import { ActionSheet } from "../mobile/ActionSheet";
import { usePhoneLayout } from "../mobile/usePhoneLayout";
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
 *  sheet from the bottom edge (mobile/ActionSheet.tsx). */
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
  const ref = useCloseOnOutsideClick<HTMLDivElement>(onClose, true);
  const pos = useViewportClamp(ref, x, y);

  return (
    <div ref={ref} className="context-menu floating-surface" style={pos}>
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
