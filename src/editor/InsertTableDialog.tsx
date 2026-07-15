import { useState } from "react";
import "./InsertTableDialog.css";

interface InsertTableDialogProps {
  title: string;
  rowsLabel: string;
  columnsLabel: string;
  confirmLabel: string;
  cancelLabel: string;
  onInsert: (rows: number, cols: number) => void;
  onClose: () => void;
}

export function InsertTableDialog({
  title,
  rowsLabel,
  columnsLabel,
  confirmLabel,
  cancelLabel,
  onInsert,
  onClose,
}: InsertTableDialogProps) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);

  function submit() {
    onInsert(Math.min(50, Math.max(1, rows)), Math.min(20, Math.max(1, cols)));
    onClose();
  }

  return (
    <div className="insert-table-overlay" onClick={onClose}>
      <div
        className="insert-table-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="insert-table-title">{title}</div>
        <div className="insert-table-fields">
          <label>
            {rowsLabel}
            <input
              type="number"
              min={1}
              max={50}
              value={rows}
              autoFocus
              onChange={(e) => setRows(Number(e.target.value))}
            />
          </label>
          <label>
            {columnsLabel}
            <input type="number" min={1} max={20} value={cols} onChange={(e) => setCols(Number(e.target.value))} />
          </label>
        </div>
        <div className="insert-table-buttons">
          <div className="insert-table-spacer" />
          <button onClick={onClose}>{cancelLabel}</button>
          <button className="insert-table-primary" onClick={submit}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
