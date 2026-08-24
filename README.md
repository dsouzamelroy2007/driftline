# Driftline

> Your messages live on your device, not ours.

A local-first, real-time chat app. The server is a transport, not an archive: it never retains a
message body once every recipient device has confirmed receipt, and holds anything undelivered for
at most 30 days before it's gone for good. Chat history, search, and unread state all live on your
device — the server keeps only who you are, who you talk to, and what's currently in flight.

This repo is a work in progress, built phase by phase as a portfolio project. Status and the current
phase are tracked in [`CLAUDE.md`](CLAUDE.md).

## Docs

- [`docs/DESIGN_REVIEW.md`](docs/DESIGN_REVIEW.md) — what we kept, changed, and dropped from the
  reference chat-system architecture, and why.
- [`docs/RETENTION.md`](docs/RETENTION.md) — the formal retention model: what's stored, for how
  long, and the exact purge rules.
- [`docs/UI_DIRECTION.md`](docs/UI_DIRECTION.md) — information architecture, screens, and the UX
  problems this architecture creates that a normal chat app doesn't have.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phase sequence and MVP scope.
- [`docs/ADR/`](docs/ADR/) — architecture decision records, including every deliberate divergence
  from the reference design.
- [`design/reference-system-design.md`](design/reference-system-design.md) — the source system-design
  study this project starts from and departs from.

A full setup guide, architecture diagram, and case study land as the corresponding phases complete
(see the roadmap).

## Getting started

Requires Node (see `.nvmrc`) and pnpm (via corepack — `corepack enable`).

```sh
pnpm install
pnpm dev          # runs apps/server and apps/web in parallel
pnpm build        # build everything
pnpm lint          # lint everything
pnpm typecheck     # typecheck everything
pnpm test          # test everything
```

`apps/server` listens on `:4000` (`/health`, plus a Socket.IO transport with no real logic yet).
`apps/web` runs the Next.js dev server on `:3000`.
