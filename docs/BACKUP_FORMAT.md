# Backup File Format

**Status:** the file format for `packages/backup`'s export/import (see
[ADR-0007](ADR/0007-backup-format.md) for the reasoning behind every choice here — this doc is the
concrete spec, not the rationale). Every field the server could ever see is opaque bytes; the server
is never involved in producing, storing, or reading a backup file at all.

## 1. The file, on disk

A `.json` file containing one object:

```json
{
  "kind": "driftline-backup",
  "version": 1,
  "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<base64>" },
  "iv": "<base64>",
  "ciphertext": "<base64>"
}
```

- `kind`/`version` are checked **before** any decryption is attempted, so opening the wrong file (or
  a future incompatible version) fails with "this doesn't look like a Driftline backup file" rather
  than a confusing crypto error.
- `kdf` records everything needed to re-derive the AES-256-GCM key from the user's passphrase:
  PBKDF2-SHA256, the salt used, and the iteration count *at export time* — recorded per-file (not
  hardcoded on import) so a future export can raise the iteration count without breaking import of
  older files.
- `iv` is the AES-GCM nonce, unique per export.
- `ciphertext` decrypts (via `crypto.subtle.decrypt`) to the plaintext payload below.

## 2. Plaintext payload (post-decryption)

```json
{
  "conversations": [
    {
      "conversationId": "…",
      "cursorSeq": 42,
      "entries": [
        {
          "envelopeId": "…",
          "senderId": "…",
          "senderDeviceId": "…",
          "seq": 1,
          "contentType": "text/plain",
          "payload": "<base64, opaque — same as the server's envelopes.payload>",
          "createdAt": 1735689600000
        }
      ]
    }
  ]
}
```

One entry per `packages/local-store` `timeline_entries` row of `kind: "message"` — markers
(`gap`/`history_start`/`dormancy_return`) are local-sync artifacts, not history, and are never
exported. `cursorSeq` is the conversation's `conversation_cursors.lastSeenSeq` at export time, needed
so import can advance the target device's cursor correctly (see §4). `createdAt` is epoch
milliseconds, not an ISO string, so the whole payload round-trips through `JSON.parse`/`JSON.stringify`
without a custom reviver.

## 3. The P2P wire format is a different, related thing

Device-linking transfer (`docs/ADR/0008-device-linking-protocol.md`) shares the plaintext model
above — same `conversations`/`entries` shape — but sends it differently:

- **No passphrase, no AES-GCM envelope.** The WebRTC data channel is already DTLS-encrypted
  end-to-end; wrapping it in a second encryption layer keyed by a passphrase the user would have to
  type mid-pairing adds friction for no real security gain.
- **Flat and chunked, not per-conversation-grouped.** Every entry is flattened to
  `{ conversationId, cursorSeq, entry }` and split into `{type: "start", totalItems}` /
  `{type: "chunk", items}` / `{type: "done"}` messages (`packages/backup/src/chunker.ts`), so a
  chunk boundary never needs to respect a conversation boundary and the receiving side can show
  progress (`x / totalItems`) as data arrives.

Both the file and P2P paths converge on the same write: `packages/local-store`'s
`importTimelineEntries`.

## 4. Import semantics

- **Additive, not destructive.** Import never deletes or replaces existing local rows.
- **Deduplicated via `envelopeId`.** `timeline_entries.envelope_id` is a UNIQUE index; importing the
  same entry twice (e.g. re-importing the same backup) is a silent no-op for that row.
- **Cursor only ever advances.** `conversation_cursors.lastSeenSeq` becomes
  `max(existing, importedCursorSeq)` per conversation — importing an old backup onto a device with
  newer independent history can't regress its live-sync state.
- **Correct chronological order is only guaranteed into an empty conversation.** `listTimeline`'s
  pagination is by local insertion order, not `createdAt`. This is fine for the designed use case —
  ADR-0003 R4: a new/reinstalled device always starts empty — and is a documented, accepted
  limitation for the rarer case of importing into a conversation that already has independent local
  history (ADR-0003's own "divergent but self-consistent" state).
- **The outbox is untouched.** Import never reads or writes `outbox` rows. The UI warns the user if
  they have unsent messages before importing, but nothing about the import itself depends on it.

## 5. What the server never sees

Nothing in this pipeline — export, the file itself, import, or the P2P transfer — ever makes a
network request to `apps/server`. The passphrase, the derived key, the plaintext payload, and the
ciphertext all stay entirely client-side, the same "opaque bytes, never parsed" posture
`envelopes.payload` already has on the server (`docs/RETENTION.md` §1).
