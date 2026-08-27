// A shared, small building block: real photo when avatarUrl resolves to one (docs/ADR/0010-profile-pictures.md),
// otherwise a solid initial-letter circle — never a broken-image icon. Sizing/color intentionally
// minimal here; a richer per-user palette is Phase 6 part 6's UI polish pass, not this one.
const SIZE_CLASSES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-xl",
} as const;

export interface AvatarProps {
  name: string;
  avatarUrl: string | null;
  size?: keyof typeof SIZE_CLASSES;
}

export function Avatar({ name, avatarUrl, size = "md" }: AvatarProps) {
  const sizeClass = SIZE_CLASSES[size];
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  if (avatarUrl) {
    // A presigned or external URL — next/image's optimizer has no business signing/proxying either,
    // same reasoning as chat/[id]/page.tsx's attachment image and lib/qr-code.tsx's QR image.
    return <img src={avatarUrl} alt={name} className={`${sizeClass} shrink-0 rounded-full object-cover`} />;
  }

  return (
    <span
      aria-hidden="true"
      className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-accent-primary font-medium text-white`}
    >
      {initial}
    </span>
  );
}
