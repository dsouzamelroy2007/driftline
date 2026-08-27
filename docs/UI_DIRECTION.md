# UI Direction

The reference architecture is silent on UI — this is built from scratch. It is the answer to "what
does a WhatsApp-class chat app look like when its core, load-bearing feature is that the server
forgets everything," and every retention-specific screen exists because that constraint demands it,
not because a generic chat app would have it.

## 1. Benchmark posture

| App | What we borrow | What we deliberately don't |
|---|---|---|
| **WhatsApp** | Thread density, reaction/reply interaction shape, composer ergonomics, overall information density on mobile. | Its backup story (opaque, cloud-vendor-dependent) — ours is explicit and user-owned. |
| **Signal** | Honesty about data loss risk, the tone of its "back up now" nagging, its device-linking QR flow as a UX reference (not implementation). | Its minimalism to the point of sparse settings — we surface more retention detail because transparency is the product's differentiator, not a settings-page afterthought. |
| **Telegram** | Multi-device-as-first-class-citizen framing, the polish of its animations and its settings information architecture. | Its "cloud is the source of truth" model — the entire premise of this app is the opposite. |

None of these three products has a reason to show a user "here is what the server currently holds of
yours and when it disappears" — for us, that's a headline screen (§6), not a hidden diagnostic.

## 2. Information architecture

```
Root
├── Auth (unauthenticated)
│   ├── Welcome / positioning ("your messages live on your device, not ours")
│   ├── Register (email + password)
│   ├── Login (password or magic link)
│   ├── OAuth (Google/GitHub) — demo one-tap path
│   └── Onboarding: "history lives here" explainer (first-run, dismissible but re-accessible)
├── Inbox (conversation list)
│   ├── Search (client-side, scoped to local store)
│   ├── New chat / New group
│   └── Conversation row (preview computed locally, unread badge computed locally)
├── Thread (per conversation)
│   ├── Message list (virtualised, date separators, unread divider)
│   ├── Composer (text, attachment, voice note, 100k-char limit)
│   ├── Message detail sheet (delivery status per device, purge timestamp)
│   └── Gap notice (inline system message, not a modal)
├── Conversation settings (per conversation)
│   ├── Members / roles (group only)
│   ├── Mute / pin / archive / block / report
│   └── (MVP+) per-conversation retention override, if shipped
├── Profile & Account
│   ├── Edit profile / avatar
│   ├── Device manager (list, last-seen, dormancy countdown, revoke)
│   ├── Backup & restore (export, import, last-backup health, reminder settings)
│   ├── Device linking (QR code, P2P transfer progress)
│   ├── Storage & retention settings (the live "server storage" widget)
│   └── Data & privacy (transparency page, deletion request flow)
└── Transparency / Legal (reachable from both auth and settings, no login required)
    ├── "What we store and for how long" (plain-English table, sourced from RETENTION.md)
    ├── Privacy Policy
    └── Terms
```

## 3. Screen inventory (MVP scope)

Auth: Welcome, Register, Login, Magic-link sent, OAuth callback, Onboarding explainer.
Core: Inbox (empty / populated / offline / loading), Thread (empty / populated / offline / loading /
error), New chat, New group + member picker, Group settings + member management, Search results.
Account: Profile edit, Device manager, Device detail (single device, revoke confirmation), Backup
export, Backup import, Backup restore progress, Device linking (QR host + QR scan + transfer
progress), Storage & retention settings, Transparency page, Data deletion request, Privacy/Terms.
System: 404, offline banner (persistent, not a screen), cold-start/reconnecting state, generic error
boundary.

## 4. Navigation model

- **Web** — responsive 3-pane above `md` breakpoint: conversation list / thread / contextual detail
  (member list, message detail sheet, or settings, depending on context). Collapses to single-pane
  stack below `md`, mirroring the mobile navigation model so the same mental model holds across
  breakpoints. Deep-linkable at every level (`/chat/:id`, `/chat/:id/settings`, `/settings/devices`).
- **Mobile** — bottom tabs for the three top-level destinations (Chats / Contacts / Settings) each
  owning a native stack; thread, settings sub-pages, device manager, and backup flows all push onto
  the relevant tab's stack. iOS gets swipe-back, Android gets hardware back — both need to be tested
  against modal flows (QR scanner, backup import) that shouldn't be back-swiped out of mid-transfer.

## 5. Design tokens

Starting point for `packages/ui-tokens` (Phase 1); revised once, in Phase 6 part 6 (the UI polish
pass — see below), otherwise stable since.

**Palette intent:** cool, low-saturation base (evokes "quiet, private, temporary") with one warm
accent reserved specifically for retention/expiry UI (the countdown, the purge visualiser) so that
"something about to disappear" reads as a distinct visual language from ordinary chat UI, not just a
recolored badge.

| Token | Light | Dark | Use |
|---|---|---|---|
| `color.bg.base` | `#FAFAF9` | `#0F1216` | App background |
| `color.bg.surface` | `#FFFFFF` | `#171B21` | Cards, panes, composer |
| `color.bg.surface-raised` | `#F1F1EF` | `#20252C` | Bubbles (incoming) |
| `color.accent.primary` | `#146B82` (deepened teal, was `#2E5F73`) | `#52B8D9` (was `#5FA3BD`) | Primary actions, sent-bubble, links |
| `color.accent.retention` | `#B8763E` (warm amber-brown) | `#D9925A` | Expiry countdowns, purge visualiser, dormancy warnings — reserved, not reused elsewhere |
| `color.text.primary` | `#1B1E22` | `#EDEFF2` | Body text |
| `color.text.muted` | `#6B7078` | `#8B919B` | Timestamps, metadata |
| `color.status.online` | `#3E9469` | `#4FBF83` | Presence dot, read-tick color (Phase 6 part 5) |
| `color.status.error` | `#C4483A` | `#E0685A` | Errors, failed sends, revoke actions |
| `color.avatar.1`–`.6` | `#146B82 #5457A6 #8B4E82 #A2455F #3E7A5B #47607A` | `#52B8D9 #8385D6 #B87CAE #D9748F #6BAE87 #7A97B3` | Fallback initial-letter avatar fill, hashed per contact (Phase 6 part 6) |
| `radius.bubble` | `18px` | same | Message bubbles |
| `radius.control` | `10px` | same | Buttons, inputs |
| type scale | `13/15/17/20/24/30` px, one family (system-ui stack + fallback to Inter) | same | Consistent across web/native via `ui-tokens` → Tailwind preset + NativeWind |

Theme resolves `prefers-color-scheme` by default, overridable per-session; no flash-of-wrong-theme on
load (SSR-resolved on web, stored preference read before first paint on native).

### Phase 6 part 6 revision (UI polish pass, added 2026-08-27)

User feedback on the shipped UI was that it read as "dull." Direction (drafted as a design canvas,
reviewed and approved before implementation): keep every structural token — radii, type scale, the
retention amber's reserved status — and address "dull" with exactly two changes.

1. **`accent.primary` deepened**, same hue family, more chroma, so it reads as a deliberate color
   choice rather than washed-out slate. Every existing `bg-accent-primary`/`text-accent-primary`
   usage picked this up automatically via the CSS custom property in `apps/web/app/globals.css` —
   no component changed for this half of the revision.
2. **A six-color avatar palette**, chroma/lightness-matched to each other and deliberately clear of
   the amber/orange band `accent.retention` occupies (a colored avatar must never look like a
   retention cue). `apps/web/components/avatar.tsx` hashes a stable per-contact seed (the other
   member's user id for a direct chat, the conversation id for a group) onto one of six literal
   Tailwind classes — every fallback initial-letter circle used to be the same flat
   `accent.primary`, which is exactly the kind of flat sameness that made scanning the Inbox feel
   dull in the first place.

Two real bugs surfaced getting this far, both fixed:

- `apps/web/tailwind.config.ts`'s `content` glob only ever scanned `./app/**` — `bg-avatar-1`
  through `bg-avatar-6` are only ever written in `components/avatar.tsx`, so Tailwind's scanner had
  never seen those class names and generated no CSS for any of them at all. Every fallback avatar
  silently rendered with no background color. Fixed by widening `content` to also cover
  `./components/**` and `./lib/**` (the latter was already working only by the coincidence of
  `lib/ui-classes.ts`'s class strings happening to also appear literally inside `app/**/*.tsx`
  files — not something to keep relying on).
- The palette lookup itself first used a template-built class name (`` `bg-avatar-${n}` ``), which
  Tailwind's static scanner can never see regardless of the `content` glob (it only recognizes
  literal class-name substrings in source). Fixed by indexing into a literal array of the six full
  class-name strings instead.

Also added while wiring the palette through: a small online/offline presence dot on the avatar
itself (Inbox rows, Thread header, conversation member list — direct contacts only, same
`docs/ADR/0011` presence data), and an Inbox-row timestamp (`apps/web/lib/format-inbox-timestamp.ts`)
that wasn't in the original Phase 5 design — flagged as a layout addition alongside the color-only
work when the direction was proposed, not something silently bundled in.

## 6. Motion principles

- **Purposeful, not decorative.** Motion communicates state change (message arriving, envelope
  purging, device going dormant) — it doesn't exist to look polished in isolation.
- **The purge visualiser (demo + settings) is the one place motion is allowed to be the point.**
  Envelopes entering, targets acking, rows disappearing — this is deliberately the most animated
  surface in the app because it's carrying the product's core idea.
- Standard interaction motion (message send, screen transitions, sheet presentation) follows platform
  convention (iOS spring curves, Material motion on Android, standard easing on web) rather than a
  custom curve library — consistency with the OS beats a bespoke feel for anything that isn't the
  retention story.
- `prefers-reduced-motion` disables all non-essential motion, including the purge visualiser's
  animation (state changes still shown, just as instant updates, not animated transitions).

## 7. Empty / loading / error / offline state strategy

Every list-shaped screen (Inbox, Thread, Search results, Device manager) defines all four states
explicitly, not just happy-path + generic spinner:

- **Empty**: distinct copy per context — "new device, no history yet, import a backup or start
  chatting" reads very differently from "no messages in this chat yet." Empty states are where most
  of the retention-specific onboarding lives, because emptiness is expected and frequent in this
  app (new device = empty, by design), not a rare edge case.
- **Loading**: skeleton screens matching final layout shape, not spinners, for anything that takes
  more than ~150ms (local-store reads should rarely hit this; network-bound screens like device
  linking will).
- **Error**: recoverable errors show inline retry; non-recoverable ones (corrupted backup file,
  failed P2P transfer) show what went wrong in plain language and the fallback path (e.g., "transfer
  failed — try exporting a backup file instead").
- **Offline**: persistent, dismissible-per-session banner, not a blocking screen — the whole point of
  the local-first model is that offline is a first-class, fully-functional state for reading and
  composing (queued to the outbox), not a degraded one.

## 8. Retention-specific UX (the novel problems this architecture creates)

These don't exist in a reference chat app and get dedicated design attention rather than being
squeezed into generic settings patterns:

- **First-run "history lives here" onboarding**: short, skippable, re-accessible from Settings →
  Data & privacy at any time. States the model in one sentence before the user sends their first
  message, not buried in a privacy policy they won't read.
- **Backup nagging**: a persistent-but-not-annoying health indicator ("last backup: 6 days ago"),
  escalating tone only after a genuinely long gap, with a snooze that actually holds (modeled on
  Signal's restraint, not WhatsApp's modal interruptions).
  **Reminder cadence (implemented as-is in Phase 6, `apps/web/lib/backup-nag.ts`):** first nag at 7 days since last backup
  or since account creation if never backed up; escalates to a stronger visual treatment at 30 days;
  snooze holds for 7 days before resurfacing, capped so it can be snoozed at most 4 times consecutively
  before the next prompt cannot be snoozed (must dismiss with an explicit "I understand the risk").
- **Device manager as a first-class screen**, not buried three taps deep: every device with last-seen,
  a visible dormancy countdown, and a one-tap revoke that's immediate and honestly labeled (not
  "sign out" — "revoke" is the plainer, more accurate word for what actually happens to pending
  envelopes).
- **Gap notices**: inline system messages in the thread itself, factual tone, always paired with the
  two recovery actions (import backup / link device) as tappable buttons, never just informational
  text with no path forward.
- **Device linking**: QR-first, with a visible transfer progress state (not just a spinner —
  approximate item/byte count) and automatic, clearly-communicated fallback to backup-file linking if
  the P2P data channel can't establish.
- **The delete-my-device panic path**: reachable from the device manager in at most two taps, asks
  for confirmation with plain consequences ("pending messages to this device will be lost — this
  can't be undone"), and completes synchronously so the user gets confirmation, not "processing."
- **The live "server storage" widget** (settings) and **retention visualiser** (public demo,
  Phase 7): the same underlying data (envelopes currently held, expiry countdown), two different
  framings — a personal, reassuring number in settings ("you currently have 0 messages held on our
  servers"), a live, animated, unmissable one in the demo, because it's the single most memorable way
  to make the architecture's core idea visible in under 30 seconds.

## 9. Accessibility posture

WCAG 2.1 AA as the floor (Phase 5 exit gate runs axe and commits the report), not an aspiration:
sufficient contrast for both palettes above (verify token pairs, not just spot-check), full keyboard
navigation on web, ARIA live regions for incoming messages so screen-reader users get the same
real-time awareness sighted users get from the UI updating, and `prefers-reduced-motion` respected
everywhere motion is used for anything beyond essential state communication.
