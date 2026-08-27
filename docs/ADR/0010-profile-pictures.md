# ADR-0010: Profile Pictures — Reusing the Private R2 Bucket, Not a Public One

**Status:** Accepted — 2026-08-27

## Context

Phase 6 part 4 (`docs/ROADMAP.md`). `users.avatarUrl` has existed unused since Phase 2's schema, and
is already populated — but only for GitHub OAuth signups, which get GitHub's own public CDN avatar
URL stored verbatim and used as-is, no signing, no expiry (`modules/auth/oauth/github.service.ts`).
Adding self-uploaded avatars means deciding how *those* get served, and the obvious-looking answer —
reuse ADR-0009's R2 bucket and presigned-upload pattern outright — doesn't transfer cleanly: ADR-0009's
whole design rests on avatars needing something GitHub's CDN URLs already have and message
attachments deliberately don't — a stable, un-expiring, directly-usable URL, not one re-minted at the
moment of authorized delivery.

## Decision

**No new R2 bucket, no public access toggle.** The obvious way to get a "stable URL, no signing"
avatar is a public bucket (or a public-access toggle on the existing one). Rejected: Cloudflare R2's
public-access setting is bucket-wide, not per-prefix — turning it on for an `avatars/` prefix would
also make every `attachments/` object (message media) fetchable by anyone who has or guesses the key,
which defeats ADR-0009's actual authorization model (delivery *is* the auth check, deliberately with
no public surface at all). A second, avatars-only bucket would avoid that, but is a new paid-tier
resource requiring a one-time manual dashboard step and possibly a re-scoped R2 API token — real
infra cost for a cosmetic feature, and this project's working agreement is to ask before that kind of
change. Self-uploaded avatars stay in the *existing* private bucket, under `avatars/{userId}/{uuid}`,
same as `attachments/{userId}/{uuid}` already does for message media.

**`users.avatarUrl` holds one of two shapes, disambiguated by a scheme check.** Either a plain
external URL (`http://`/`https://` — currently only ever GitHub's CDN URL, used verbatim) or a bare
R2 key with no scheme (self-uploaded). `resolveAvatarUrl` (`modules/users/avatar.service.ts`) is the
one place that tells them apart and, for a bare key, mints a presigned GET. No new schema — the
existing nullable `text` column already fits either shape, and this is exactly the kind of column
reinterpretation that doesn't need a migration, unlike adding a new one.

**The presigned avatar URL is long-lived (24h), unlike message media's 300s.** Message-media URLs are
minted once per authorized delivery and consumed immediately (`docs/ADR/0009`'s whole point is that
delivery *is* the auth check, so a short TTL costs nothing). An avatar is resolved once per API
response (`/me`, `/users/lookup`, `GET`/`POST /conversations`'s member list) and then displayed
un-refreshed for however long that page stays open — Inbox rows, a Thread header, Settings. A 300s
TTL would go visibly stale mid-session for no security benefit (an avatar isn't retention-sensitive
content); 24h comfortably outlives a normal browsing session and is well under SigV4's 7-day signing
max. `createDownloadUrl` (`lib/r2-client.ts`) now takes an optional `expiresInSeconds`, defaulting to
the original 300s so message-media callers are unaffected.

**Replacing an avatar best-effort deletes the old R2 object, if it was one.** Unlike ADR-0009's
accepted "orphaned object" risk for a never-sent upload (a genuinely rare race), a user changing their
photo repeatedly is an expected, common action — leaving every previous upload behind indefinitely is
needless accumulation, not a rare edge case, so it's worth the small extra delete call.
`updateProfile` (`modules/users/users.service.ts`) does this after the DB write commits, catching and
logging any failure the same way `cleanupPurgedMedia` does — never allowed to fail the profile update
itself. An external (OAuth) URL is never deleted; it was never ours to own.

**Upload reuses ADR-0009's allowlist (`MEDIA_CONTENT_TYPES`), with a smaller 5MB cap.** A second,
separately-maintained content-type allowlist for avatars would just be one more place to keep in sync
with the first; the only real difference an avatar needs is a tighter size limit than a full message
image.

## Consequences

- **Two different "kinds" of value in one column** is a small ongoing cost — anyone touching
  `avatarUrl` needs to know the scheme check exists (`resolveAvatarUrl`/`isOwnedAvatarKey` in
  `avatar.service.ts` are the only two places that should ever need to). Documented here and at the
  column's read sites rather than solved with a second column, since a second column (e.g.
  `avatarKey` vs `avatarExternalUrl`) would need an actual migration for a distinction that only
  matters inside one small resolver function.
- **A stale-for-up-to-24h avatar after a change** is possible in principle (another device/tab holding
  an already-resolved URL from before a photo change won't see the update until it re-fetches `/me`
  or the conversation list) — acceptable for a cosmetic field with no security implication, and no
  different in kind from any other cached profile data in this app.
- **Backup export/import and device-linking transfer don't carry avatars at all** — `avatarUrl` lives
  on `users`, not on a per-message timeline entry, so it's out of scope for `packages/backup`
  entirely; the receiving device already has (or will separately fetch) the same account's `/me`
  data as this device does. Not a gap the way ADR-0009's was.

## Alternatives considered and rejected

- **A dedicated public R2 bucket for avatars**: rejected for this pass — see Decision. Worth
  revisiting if this project ever needs public, unsigned asset URLs for another reason too (at which
  point the one-time setup cost is shared across more than just avatars).
- **Presigning avatar URLs at the same 300s TTL as message media, refreshed via polling**: rejected —
  would need every avatar-displaying surface (Inbox, Thread header) to poll and re-fetch just to keep
  images from breaking mid-session, real added complexity for a cosmetic feature with no retention
  requirement forcing a short TTL in the first place.
- **A separate avatar content-type allowlist/size cap module**: rejected — see Decision.
