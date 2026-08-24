# ADR-0004: Auth Token Model

**Status:** Accepted — 2026-08-24

## Context

Phase 2 needs to pick how a client proves its identity on subsequent requests after login. The
obvious default for a web-first app is a cookie-based session. But `docs/ROADMAP.md` is explicit that
`packages/*` must be genuinely platform-agnostic ahead of Phase 10 (mobile/Expo) — "it goes smoother
the fewer web-coupled assumptions leaked into those packages," not retrofitted later. Cookies are a
browser-origin concept; they don't travel cleanly to a React Native/Expo client, and `apps/web`
(Vercel) and `apps/server` (Render) are already different origins, which pushes cookie-based auth
toward `SameSite=None` complexity for no real benefit over the alternative.

Separately, the domain model itself is device-centric, not just user-centric: `docs/RETENTION.md`
keys fan-out (`EnvelopeTarget`), dormancy, and revocation off `deviceId`, not `userId` alone. Auth
needed to reflect that same shape rather than bolt a device concept on top of a user-only session.

## Decision

Bearer tokens, not cookies, scoped to `(userId, deviceId)`:

1. **Access token**: a short-lived JWT (~15 min, HS256, `JWT_SECRET`), `sub` = userId, custom claim
   `deviceId`. Sent as `Authorization: Bearer <token>` on HTTP and (Phase 3) in the Socket.IO
   handshake `auth` payload — same token, same verification path, no separate web/socket auth
   systems.
2. **Refresh token**: an opaque high-entropy random value (32 bytes, base64url), never a JWT. The
   server stores only its SHA-256 hash plus an expiry, on the owning `devices` row — one active
   refresh token per device at a time. Using it rotates it: a successful `/auth/refresh` immediately
   overwrites the stored hash, so a stolen-and-reused old refresh token fails on its next use.
3. **Revocation is checked on every authenticated request, not just at token issuance.** JWTs are
   normally stateless and can't be "revoked" before they expire, but `docs/RETENTION.md` §5 requires
   device revocation to take effect immediately. The access-token verification path re-checks the
   device's `revokedAt` against the database on each request — a deliberate, small statefulness cost
   accepted specifically so "log out this device" in the future device-manager UI is immediate, not
   "eventually, once the access token expires."
4. **Logout vs. revoke are different operations.** `POST /auth/logout` clears only the current
   device's refresh token (ends the session; the device row and its identity persist, and it can log
   in again later). `DELETE /devices/:id` is the stronger, final action — it sets `revokedAt`, which
   the check in point 3 makes immediately effective. This mirrors `docs/RETENTION.md` §5's own
   distinction between passive/reversible dormancy and active/final revocation, applied one level up
   to sessions vs. devices.

## Consequences

- Web and the future Expo client use the exact same auth flow and the exact same
  `packages/*`-shareable token-handling code — no cookie/bearer split to maintain across platforms.
- The 15-minute access-token tail after a revoke-adjacent action other than explicit device
  revocation (e.g., a plain logout) is an accepted gap: logout only clears the refresh token, so a
  still-valid access token keeps working for up to 15 minutes. This is intentional — logout is a
  "don't automatically reconnect," not a security incident response; revocation (which does need to
  be immediate) goes through the device-row check instead.
- Every authenticated request costs one extra indexed lookup (the device revocation check) compared
  to a fully stateless JWT scheme. Acceptable at this scale; would be the first thing to reconsider
  (e.g., a short-TTL revocation cache) if request volume ever made it matter.
- No session storage in Redis or Postgres beyond the refresh-token hash already living on the device
  row — nothing new to purge under the retention model, and nothing that stores content.

## Alternatives considered and rejected

- **Cookie-based sessions** (the default for a web-first app): rejected for the mobile-portability
  reason above — would need a parallel bearer-token path for Expo anyway, doubling the auth surface
  instead of sharing it.
- **Fully stateless JWT with no revocation check** (classic short-TTL-access/long-TTL-refresh, no DB
  read on the hot path): rejected because it can't satisfy "revocation is immediate," which
  `docs/RETENTION.md` treats as a hard requirement, not a nice-to-have.
- **Refresh token as a JWT too** (self-contained, no DB lookup to validate): rejected — an opaque
  token that must be looked up by its hash is trivially revocable and rotatable server-side; a
  self-contained refresh JWT would need its own blocklist to revoke early, which is more state, not
  less.
