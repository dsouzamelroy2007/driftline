# Roadmap

"Session" below means one focused working session with the agent, ending at that phase's exit gate —
not a calendar estimate. No fixed launch date has been set (open question, §5); sessions are a
planning unit for sequencing, not a deadline commitment.

## MVP cut (updated per Phase 0 decisions)

**MVP** — auth + device registry, 1:1 chat, group chat (≤100 members), presence, typing,
delivery/read receipts, client-side history + search, offline outbox, encrypted backup export/import,
**P2P device-to-device history transfer (QR + WebRTC, with automatic fallback to backup-file
linking)**, push notifications.

> P2P transfer was moved into MVP scope during Phase 0 discovery (default in the master plan was
> stretch). This is recorded in [ADR-0003](ADR/0003-multi-device-sync-without-server-history.md)
> along with the fallback plan if the WebRTC work proves too costly mid-Phase-6.

**MVP+** — attachments, reactions, replies, edit/delete-for-everyone, link previews, voice notes.

**Stretch** (only after Phase 13, only if requested) — E2E encryption, calls, status/stories,
disappearing messages shorter than 30 days, admin/moderation tooling, i18n, desktop via Tauri.

Retention window: `RETENTION_WINDOW_DAYS = 30` is a **global constant for MVP**, not
per-conversation (see [ADR-0002](ADR/0002-retention-storage-model.md)). Per-conversation TTL is
explicitly MVP+.

## Phase sequence

| Phase | Goal | Est. sessions | Depends on |
|---|---|---|---|
| 0 | Discovery, design & retention model (this phase) | 1 | — |
| 1 | Monorepo foundation & DX | 1 | 0 |
| 2 | Identity, devices & service discovery | 2 | 1 |
| 3 | Relay core: store-and-forward, fan-out & retention | 3 | 2 |
| 4 | Client sync engine & local-first store | 2–3 | 3 |
| 5 | Web client (portfolio-grade UI) | 3–4 | 4 |
| 6 | Backup, device linking, media & client-side search | 3 | 4, partially 5 |
| 7 | Deployment & live demo | 1–2 | 5, 6 |
| 8 | Hardening, observability & retention compliance | 2 | 7 |
| 9 | GitHub integration & CI/CD | 1–2 | 8 (some of this can start as early as Phase 1 in practice — branch protection, basic `ci.yml` — but the full workflow set including `retention.yml` needs Phase 3+8 done to have something real to check) |
| 10 | Mobile app foundation (Expo) | 2 | 4 (shares packages), benefits from 5 existing as a UI reference |
| 11 | Push, deep links & native integrations | 2 | 10 |
| 12 | Store release (Android & iOS) | 1–2 sessions + external wait time (review queues, my own account setup) | 11 |
| 13 | Portfolio polish & case study | 1 | everything above |

Phases 5 and 6 both depend on Phase 4 and can interleave somewhat (backup/search UI in Phase 6 needs
some of Phase 5's shell), but Phase 3 must be fully done and correct before either starts — the relay
core's retention guarantees are the thing the whole rest of the product is honest about, so it isn't
worth building UI against a relay that doesn't purge correctly yet.

## Dependencies worth calling out explicitly

- **Phase 3 is the gate for everything client-facing.** Its exit criteria include an automated test
  proving zero message bodies survive in the DB after all parties ack — nothing in Phase 4+ should be
  built against a relay that hasn't cleared that bar.
- **Phase 9's `retention.yml`** (CI job asserting the retention invariants) can only be meaningfully
  written once Phase 3 (the purge logic it's testing) and Phase 8 (the monitoring/alerting it
  complements) both exist. Basic CI (`ci.yml`: lint/typecheck/test/build) is worth standing up as
  early as Phase 1, though — no reason to wait on that part.
- **Phase 10 (mobile)** is explicitly designed to consume `packages/*` with zero duplicated logic —
  it goes smoother the fewer web-coupled assumptions leaked into those packages during Phases 4–6, so
  Phase 4's local-store interface and Phase 6's backup format need to be genuinely
  platform-agnostic from the start, not retrofitted in Phase 10.

## Open questions not yet resolved (deferred, not blocking Phase 0 exit)

1. **Custom domain.** No domain decision made yet — MVP ships on Vercel/Render default subdomains.
   Revisit at Phase 7 (deployment) once the demo is live and worth pointing a real domain at.
2. **Target launch date.** No fixed date; sessions above are for sequencing, not a calendar
   commitment. Can be revisited if a real deadline (e.g., a job application timeline) emerges.
3. **Paying for store accounts** (Apple Developer $99/yr, Google Play $25 one-time). Not a Phase 0
   decision — surfaces concretely at Phase 12, where the free-path fallback (TestFlight + Play
   internal testing + sideloadable signed APK) is documented regardless, so this is a "decide when we
   get there" item, not a blocker now.
4. **Device-record cleanup after long-term dormancy** — carried from `docs/RETENTION.md` §8, to be
   closed out once the device manager UI (Phase 5) makes the trade-off concrete.
