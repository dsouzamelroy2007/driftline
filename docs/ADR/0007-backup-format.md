# ADR-0007: Encrypted Backup File Format

**Status:** Accepted — 2026-08-26

## Context

ADR-0003 names encrypted backup export/import as the baseline (ships-first) path for a new or
reinstalled device to recover prior history, with device-to-device WebRTC transfer (ADR-0008) as
the second, higher-effort path — and the required fallback if that transfer can't establish. Both
paths need to move a device's full local-store history (`packages/local-store`) off of it and back
onto another device, without the server ever holding — or being able to read — any of it
(`docs/RETENTION.md`: the server is a transport, not an archive, and that guarantee can't have a
backup-file-shaped hole in it).

## Decision

**A single new package, `packages/backup`**, owns this end-to-end rather than folding it into
`packages/local-store` — it's a distinct concern (serialization + cryptography) from local-store's
storage engine, the same reasoning ADR-0006's local-store/sync-engine split already used. It depends
on `@driftline/local-store` the same way `packages/sync-engine` does, so it's available to the
future Expo/mobile client (Phase 10) with zero duplicated logic.

**Encryption: PBKDF2-SHA256 → AES-256-GCM, via the Web Crypto API (`crypto.subtle`) — no crypto
dependency.** `crypto.subtle` is available identically in the browser and in Node ≥22 (this repo's
minimum), and carries forward to Expo (`expo-crypto` exposes the same `SubtleCrypto` surface),
matching ADR-0006's "one implementation, three future platforms" goal. PBKDF2 iteration count is set
to current OWASP guidance for a passphrase-derived key (600,000). The passphrase — and the resulting
key — never leaves the device and is never sent to or derivable by the server; this is a pure
client-side operation, matching `envelopes.payload`'s existing "opaque bytes, never parsed
server-side" precedent.

**File format:** a small versioned JSON envelope:

```json
{ "kind": "driftline-backup", "version": 1, "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "…" }, "iv": "…", "ciphertext": "…" }
```

`kind`/`version` are checked *before* attempting decryption, so a non-backup JSON file (or a future
incompatible version) fails with a clear "this doesn't look like a Driftline backup" message rather
than a confusing crypto error. The `ciphertext` decrypts to a plaintext JSON payload —
`{ conversations: [{ conversationId, cursorSeq, entries: [...] }] }` — one entry per historical
message (`packages/local-store`'s `timeline_entries` rows of `kind: "message"` only; markers like
`gap`/`history_start` are local-sync artifacts, not history, and aren't exported). Full spec:
`docs/BACKUP_FORMAT.md`.

**A wrong passphrase and a tampered/corrupted ciphertext produce the same generic error.** AES-GCM's
authentication tag check fails identically for both cases, and there's no reason to give a more
specific oracle than "couldn't decrypt — check your passphrase," consistent with this project's
existing "don't leak why" posture (e.g. login's password-mismatch response, magic-link's
does-this-email-exist non-disclosure).

**Import is additive and dedup-safe, not a wipe-and-replace.** `packages/local-store`'s new
`importTimelineEntries` inserts directly (bypassing the live-sync `classifyAndAdvanceCursor` path,
which assumes strictly sequential server-assigned `seq` and isn't meaningful for a batch of already-
ordered history), deduplicates via the existing `envelopeId` UNIQUE index, and only ever advances
`conversation_cursors.lastSeenSeq` forward, never backward. Re-importing the same backup twice is a
safe no-op.

## Consequences

- Correct chronological rendering (`listTimeline`'s pagination is by local insertion order, not
  `createdAt`) is only guaranteed when importing into a conversation with **no prior local rows** —
  which is exactly ADR-0003's designed use case (a new/reinstalled device always starts empty).
  Importing an old backup onto a device that already has independent newer history is the
  "divergent but self-consistent" state ADR-0003 already treats as expected, not a bug; its
  resulting local display order is a documented, accepted limitation rather than a reason to rework
  `listTimeline`'s pagination cursor for a rare case.
- The backup file's AES-GCM envelope is deliberately **not** reused as the wire format for
  device-to-device transfer (ADR-0008) — the two transports have different needs (a static
  passphrase-encrypted blob vs. a live, chunked, already-DTLS-encrypted stream). They share the same
  inner plaintext model (`packages/backup/src/serialize.ts`) so both write paths funnel through the
  same `importTimelineEntries` call, but the file format's crypto envelope is not part of the P2P
  wire format at all.
- Losing every device without ever exporting a backup is unrecoverable data loss, as ADR-0002/0003
  already state plainly — this ADR doesn't soften that; it only makes the recovery path real. The
  backup-nagging UX (`docs/UI_DIRECTION.md` §8) is what keeps this from being a silent trap.

## Alternatives considered and rejected

- **A key derived from the user's account password**, so the user doesn't need to remember a
  separate backup passphrase: rejected — the server would need to be involved in deriving or
  verifying that key, reintroducing a server-side dependency for something ADR-0002 explicitly wants
  off the server entirely. A separate, purely local passphrase keeps the guarantee absolute.
- **scrypt/Argon2 instead of PBKDF2**: both are stronger key-derivation functions, but neither has a
  native Web Crypto implementation — using either would mean pulling in a WASM or pure-JS KDF
  library. PBKDF2-SHA256 at a high iteration count via the already-available `crypto.subtle` was
  judged the better trade-off for a $0-budget project with no server-side involvement to harden
  against in the first place (the threat model here is "don't let a stolen backup file be trivially
  decryptable," not "resist a nation-state's ASIC farm").
