import { useState } from "react";
import "./ImageNameDialog.css";

export interface ImageNameRequest {
  stem: string;
  extension: string;
  resolve: (stem: string | null) => void;
}

export function ImageNameDialog({
  request,
  title,
  label,
  invalidLabel,
  uploadLabel,
  cancelLabel,
  onClose,
}: {
  request: ImageNameRequest;
  title: string;
  label: string;
  invalidLabel: string;
  uploadLabel: string;
  cancelLabel: string;
  onClose: (stem: string | null) => void;
}) {
  const [stem, setStem] = useState(request.stem);
  const valid = !!stem.trim() && !/[\\/]/.test(stem);

  function submit() {
    if (valid) onClose(stem.trim());
  }

  return (
    <div className="image-name-overlay" onClick={() => onClose(null)}>
      <div
        className="image-name-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
          if (event.key === "Escape") onClose(null);
        }}
      >
        <div className="image-name-title">{title}</div>
        <label className="image-name-field">
          <span>{label}</span>
          <span className="image-name-input-row">
            <input
              autoFocus
              aria-label={label}
              value={stem}
              aria-invalid={!valid}
              onChange={(event) => setStem(event.target.value)}
            />
            <span>.{request.extension}</span>
          </span>
        </label>
        {!valid && <div className="image-name-error">{invalidLabel}</div>}
        <div className="image-name-buttons">
          <button onClick={() => onClose(null)}>{cancelLabel}</button>
          <button
            className="image-name-primary"
            disabled={!valid}
            onClick={submit}
          >
            {uploadLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
