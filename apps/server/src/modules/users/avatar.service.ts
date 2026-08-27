import type { R2Context } from "../../plugins/app-context.js";
import { createDownloadUrl } from "../../lib/r2-client.js";
import { MEDIA_CONTENT_TYPES } from "../media/media.service.js";

// Avatars share the message-media image allowlist (docs/ADR/0009) rather than a second one that
// could drift out of sync — a smaller size cap is the only real difference a profile photo needs.
export const AVATAR_CONTENT_TYPES = MEDIA_CONTENT_TYPES;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

// Long-lived on purpose (unlike message media's 300s, minted fresh per delivery): an avatar isn't
// retention-sensitive, gets resolved once per response and then displayed for a whole browser
// session (Inbox rows, Thread header, Settings), and re-minting per view the way message delivery
// does would mean it goes stale mid-session for no benefit. Well under SigV4's 7-day signing max.
const AVATAR_DOWNLOAD_URL_TTL_SECONDS = 60 * 60 * 24;

// users.avatarUrl (docs/ADR/0010-profile-pictures.md) holds one of two shapes: a plain external URL
// (e.g. GitHub OAuth's own CDN avatar, already public — used as-is, never signed) or a bare R2 key
// under `avatars/` (self-uploaded — resolved to a fresh presigned GET here). Never null-checked by
// callers beyond "is this already a URL" — a raw key never starts with a scheme, so the check is
// unambiguous both directions.
function isExternalAvatarUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

export async function resolveAvatarUrl(r2: R2Context, rawValue: string | null): Promise<string | null> {
  if (!rawValue) return null;
  if (isExternalAvatarUrl(rawValue)) return rawValue;
  return createDownloadUrl(r2.client, r2.bucket, rawValue, AVATAR_DOWNLOAD_URL_TTL_SECONDS);
}

// Only a self-uploaded avatar (a bare R2 key) has an object worth cleaning up when it's replaced —
// an external OAuth-provided URL was never ours to delete. Best-effort, same posture as
// modules/media/media.service.ts's cleanupPurgedMedia: never allowed to fail the profile update
// itself, since avatars are cosmetic, not part of the retention guarantee.
export function isOwnedAvatarKey(value: string | null): value is string {
  return !!value && !isExternalAvatarUrl(value);
}
