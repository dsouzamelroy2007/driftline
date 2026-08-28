# Runbook

Operational reference for the live deployment (`apps/server` on Render, `apps/web` on Vercel — see
the README for the current live-demo URL) and for local dev. Written from real incidents hit during
this project's own Phase 7/8 work, not hypothetical scenarios — each section below either already
happened once or is the direct mitigation for something in [`SECURITY.md`](SECURITY.md) or
[`RETENTION.md`](RETENTION.md).

## 1. Health check

`GET /health` on the server returns:

```json
{ "status": "ok", "checks": { "db": "ok", "redis": "ok" } }
```

or, with either dependency unreachable (2-second timeout each):

```json
{ "status": "degraded", "checks": { "db": "error", "redis": "ok" } }
```

with HTTP `503` instead of `200`. This is what Render's own health check polls — a `degraded` result
means the instance is up but genuinely can't serve most requests; Render should be restarting it
automatically. If it isn't, check Render's dashboard → the service → **Settings** → confirm a health
check path is actually configured to `/health` (a plain "is the process alive" check would miss this
entirely, since the process itself hasn't crashed).

`/health` is intentionally unauthenticated and unrated-limited (see `SECURITY.md` §2) — it needs to
be cheaply pollable by the platform without a token.

## 2. The retention alert fired in Sentry

`RETENTION.md` §7's monitoring requirement is live: every sweep cycle,
`modules/relay/retention-monitor.ts` checks the oldest envelope still in the table, and if it's older
than `RETENTION_WINDOW_DAYS`, reports a `fatal`-level event to Sentry plus a
`retention_violation_total` structured log line. **This should never fire in a healthy deployment —
treat it as a genuine incident, not noise.** If it does:

1. Check the Render service's logs for `"retention sweep"` lines (`apps/server/src/index.ts`) —
   they should appear roughly every 5 minutes. A gap longer than that means the in-process
   `setInterval` stopped, most likely because an unhandled exception inside it crashed the process.
   Phase 8's `uncaughtException` guard means that crash is now logged (and reported to Sentry) before
   the process exits and Render restarts it — look for that log line right before the gap.
2. Once the sweeper is confirmed running again, `sweepExpiredEnvelopes` (`modules/relay/sweeper.ts`)
   should clear the backlog on its next cycle — its query has no upper bound on how overdue an
   envelope can be. Confirm via `retention-monitor`'s next scheduled check reporting compliant again
   (no further Sentry event), not by assuming it's fixed.
3. If the sweeper *is* running but envelopes are still aging past the window, that's a real bug in
   `expiresAt` computation or the sweeper's own query — not an infra blip. This is exactly the
   scenario `retention-monitor.test.ts` exists to catch before it ever reaches production.

## 3. CORS breaks after a deploy

**Symptom:** the web app can't reach the server at all — every request fails client-side with a CORS
error in the browser console, but `curl -i -X OPTIONS <url>` against the same endpoint looks
completely fine (`204`, headers present).

**Cause, confirmed live during Phase 7:** `curl` doesn't enforce CORS — it just shows you whatever
header the server sent, even if the value is wrong. The actual bug was a trailing slash in Render's
`WEB_ORIGIN` env var. A real browser's `Origin` header never has a trailing slash, so the exact
string comparison the browser performs against `Access-Control-Allow-Origin` failed every time, even
though the server happily returned `204` to any `curl` check.

**Fix:** Render dashboard → the service → **Environment** → `WEB_ORIGIN` → confirm it's exactly the
Vercel origin with no trailing slash, no path. **Env var changes on Render don't always trigger an
automatic redeploy on save** — if the fix doesn't take effect within a minute, trigger a **Manual
Deploy** explicitly from the service's Deploys tab.

**To verify the fix actually landed** (don't trust `curl`'s `204` alone):

```sh
curl -sSi -X OPTIONS https://<render-url>/auth/register \
  -H "Origin: https://<vercel-url>" \
  -H "Access-Control-Request-Method: POST" \
  | grep -i access-control-allow-origin
```

The returned value must be **byte-for-byte identical** to the `Origin` you sent, no trailing slash.

## 4. Deployed code is stale / a shipped fix "isn't there"

**Symptom:** a bug that was definitely fixed and committed still reproduces against the live URLs.

**Cause, confirmed live during Phase 7:** this project's working agreement is to commit directly on
`main` with no PRs (see CLAUDE.md), which makes it easy to accumulate several good commits locally
without ever running `git push`. Render and Vercel both auto-deploy from `origin/main` — they have
no visibility into local commits at all.

**Fix:** `git status` first — "Your branch is ahead of 'origin/main' by N commits" is the tell.
`git push`, then wait for both platforms' dashboards to show a fresh deploy (Render's Events tab,
Vercel's Deployments tab) before re-testing. Confirming the *code*, not just the deploy status, is
worth doing directly when in doubt — fetch a page's compiled JS chunk and grep for a string unique
to the fix, the way Phase 7's verification did, rather than trusting a green checkmark alone.

## 5. Local dev: stale `pnpm dev` process

**Symptom:** a code change doesn't show up in the browser, or the app behaves like an old build,
despite the file clearly being saved. This has caused false "the fix didn't work" conclusions at
least twice in this project's history before being identified.

**Fix:** never assume a long-running `pnpm dev` in some other terminal is still fresh. Check for it
and kill it before starting a new one:

```sh
ps aux | grep -E "next-server|tsx watch|turbo run dev" | grep -v grep
kill <pid> <pid> ...
```

Then start clean, with the env vars actually loaded into the shell (Turborepo's `loose` env mode
still needs them present in the parent shell — see §7 below for why `loose` mode was needed at all):

```sh
set -a; source .env; set +a
pnpm dev
```

## 6. Local dev: `apps/web` binds to the wrong port

**Symptom:** `apps/server` fails to start, or `apps/web` and `apps/server` collide on the same port.

**Cause:** `apps/server`'s `PORT` env var (which must stay named exactly `PORT` — Render sets it
automatically by platform convention) leaks into `apps/web`'s `next dev` process once Turborepo's
env mode is `loose` (see §7), and Next.js respects a `PORT` env var if present. Fixed already —
`apps/web/package.json`'s `dev`/`start` scripts pin `-p 3000` explicitly — but worth knowing if a
future script change accidentally drops that flag.

## 7. Local dev: env vars silently missing under `pnpm dev`

**Symptom:** `apps/server` crashes at startup with a wall of zod "Required" errors that look like a
broken `.env` file, even though `.env` is filled in correctly.

**Cause:** Turborepo 2.x defaults to *strict* env mode, which only passes through env vars a task
explicitly declares — and nothing in `turbo.json` declared any for the `dev` task, so every custom
var (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, all the rest) was silently stripped before `apps/server`
ever saw them. Fixed via `"envMode": "loose"` in `turbo.json`, which passes the full parent shell
environment through instead. If this regresses (e.g. someone "fixes" it back to strict mode without
realizing why loose was chosen), the fix is the same one-line change, not per-var declarations.

## 8. Rollback

Both platforms deploy from `origin/main` on every push — there is no separate release/tag step.
To roll back a bad deploy: `git revert <bad-commit>` and push (never `git push --force` to `main`,
even to "undo" something — a revert commit keeps history honest and re-triggers both platforms'
normal deploy path). Alternatively, both Render and Vercel dashboards can redeploy a specific
previous successful build directly from their Deploys/Deployments tab without touching git at all —
useful for an immediate mitigation while a proper revert is prepared.

## 9. Where the logs actually live

**Sentry** (sentry.io, the project tied to `SENTRY_DSN`) is where 5xx errors, uncaught
exceptions/rejections, and retention violations actually get aggregated, deduplicated, and are
searchable by stack trace — see `SECURITY.md` §5. It's the first place to check for an actual
incident. For everything else (routine structured `{"metric": "...", ...}` lines, Fastify's request
logs, boot/shutdown lines): Render's dashboard → the service → **Logs** tab, which is not queryable
beyond a simple text filter. Vercel's own dashboard → the project → **Logs** covers `apps/web`'s
build and runtime (route handler) logs separately — the two are never unified.
