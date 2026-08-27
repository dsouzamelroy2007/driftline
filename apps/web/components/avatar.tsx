// A shared, small building block: real photo when avatarUrl resolves to one (docs/ADR/0010-profile-pictures.md),
// otherwise a solid initial-letter circle — never a broken-image icon. Fallback fill color is hashed
// from `seed` across a 6-hue palette (docs/UI_DIRECTION.md §5, Phase 6 part 6) rather than one flat
// accent-primary circle for every contact — the biggest single legibility win when scanning a list.
const SIZE_CLASSES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-xl",
} as const;

// Literal class names, not a template-built `bg-avatar-${n}` string — Tailwind's content scanner
// only picks up classes it can see verbatim in source, so a computed string here would silently
// generate no CSS at all for any of the six colors (the bug this comment is here to prevent
// reintroducing).
const PALETTE_CLASSES = ["bg-avatar-1", "bg-avatar-2", "bg-avatar-3", "bg-avatar-4", "bg-avatar-5", "bg-avatar-6"] as const;

// Not cryptographic — just needs to be stable for a given seed and spread reasonably across the
// palette, so the same contact always lands on the same color.
function paletteClassFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return PALETTE_CLASSES[Math.abs(hash) % PALETTE_CLASSES.length]!;
}

export interface AvatarProps {
  name: string;
  avatarUrl: string | null;
  /** A stable identifier (user id, or a conversation id for a group with no single contact) used
   * only to pick a consistent fallback color — never rendered or sent anywhere. */
  seed: string;
  size?: keyof typeof SIZE_CLASSES;
  /** Shows a small presence dot, ringed to cut out of the avatar — direct-conversation contacts
   * only (docs/ADR/0011-presence-and-receipts.md); omit for groups and self. */
  online?: boolean;
}

export function Avatar({ name, avatarUrl, seed, size = "md", online = false }: AvatarProps) {
  const sizeClass = SIZE_CLASSES[size];
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const paletteClass = paletteClassFor(seed);

  return (
    <span className="relative inline-flex shrink-0">
      {avatarUrl ? (
        // A presigned or external URL — next/image's optimizer has no business signing/proxying
        // either, same reasoning as chat/[id]/page.tsx's attachment image and lib/qr-code.tsx's QR
        // image.
        <img src={avatarUrl} alt={name} className={`${sizeClass} rounded-full object-cover`} />
      ) : (
        <span
          aria-hidden="true"
          className={`${sizeClass} flex items-center justify-center rounded-full ${paletteClass} font-medium text-white`}
        >
          {initial}
        </span>
      )}
      {online && (
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-surface bg-status-online"
        />
      )}
    </span>
  );
}
