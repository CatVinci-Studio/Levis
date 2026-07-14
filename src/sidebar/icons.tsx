type IconProps = { className?: string };

export function ChevronIcon({ className }: IconProps) {
  return (
    <svg className={className} width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FolderIcon({ className }: IconProps) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path
        d="M1.5 3.5C1.5 2.94772 1.94772 2.5 2.5 2.5H6L7.5 4H13.5C14.0523 4 14.5 4.44772 14.5 5V11.5C14.5 12.0523 14.0523 12.5 13.5 12.5H2.5C1.94772 12.5 1.5 12.0523 1.5 11.5V3.5Z"
        fill="currentColor"
        opacity="0.75"
      />
    </svg>
  );
}

export function FolderOpenIcon({ className }: IconProps) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M1.5 3.5C1.5 2.94772 1.94772 2.5 2.5 2.5H6L7.5 4H13V5H2.2L1.5 3.5Z" fill="currentColor" opacity="0.75" />
      <path
        d="M1.2 6H14.3C14.7 6 15 6.37 14.9 6.76L13.5 12.1C13.4 12.4 13.1 12.6 12.8 12.6H2.2C1.9 12.6 1.6 12.4 1.5 12.1L0.9 6.76C0.85 6.37 1.15 6 1.55 6H1.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function MarkdownFileIcon({ className }: IconProps) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4 10.5V5.5L6.3 8L8.6 5.5V10.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 5.5V10.5M10.5 10.5L9 8.8M10.5 10.5L12 8.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ImageFileIcon({ className }: IconProps) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="5.3" cy="5.8" r="1.1" fill="currentColor" />
      <path d="M2.5 11.5L6 8L8.5 10.2L10.8 7.5L13.5 11" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GenericFileIcon({ className }: IconProps) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path
        d="M3.5 2C3.5 1.72386 3.72386 1.5 4 1.5H9L12.5 5V13.5C12.5 13.7761 12.2761 14 12 14H4C3.72386 14 3.5 13.7761 3.5 13.5V2Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M9 1.5V5H12.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

export function TreeTabIcon({ className }: IconProps) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path
        d="M1.5 3.5C1.5 2.94772 1.94772 2.5 2.5 2.5H6L7.5 4H13.5C14.0523 4 14.5 4.44772 14.5 5V11.5C14.5 12.0523 14.0523 12.5 13.5 12.5H2.5C1.94772 12.5 1.5 12.0523 1.5 11.5V3.5Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function OutlineTabIcon({ className }: IconProps) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="2.3" cy="3.5" r="1" fill="currentColor" />
      <path d="M5.2 3.5H14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="4" cy="8" r="1" fill="currentColor" />
      <path d="M6.9 8H14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="4" cy="12.5" r="1" fill="currentColor" />
      <path d="M6.9 12.5H14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function ClipboardTabIcon({ className }: IconProps) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="2.8" width="10" height="11.5" rx="1.3" stroke="currentColor" strokeWidth="1.1" />
      <rect x="5.5" y="1.5" width="5" height="2.4" rx="0.8" fill="currentColor" />
      <path d="M5.5 7.5H10.5M5.5 10.5H10.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function ChatTabIcon({ className }: IconProps) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path
        d="M2 3.8C2 3.02 2.63 2.4 3.4 2.4H12.6C13.37 2.4 14 3.02 14 3.8V9.4C14 10.17 13.37 10.8 12.6 10.8H6.4L3.6 13.2V10.8H3.4C2.63 10.8 2 10.17 2 9.4V3.8Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"]);

export function fileIconFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md" || ext === "markdown") return MarkdownFileIcon;
  if (IMAGE_EXTS.has(ext)) return ImageFileIcon;
  return GenericFileIcon;
}
