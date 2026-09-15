# CareHub Ecosystem

## Vision

CareHub is an enterprise healthcare operating system built for pharmacies, hospitals, laboratories, imaging centers and other healthcare providers.

CareFind is the public discovery platform that allows patients to search for healthcare providers, medicines, laboratory services and healthcare facilities.

Together, CareHub and CareFind form one healthcare ecosystem.

---

## Mission

To build the most comprehensive healthcare SaaS platform in Africa while maintaining enterprise-grade software engineering standards.

---

## Products

### CareHub

Internal SaaS platform for healthcare businesses.

Core Modules:

- Pharmacy
- Hospital
- Laboratory
- Imaging
- Inventory
- Billing
- Finance
- Reports
- Staff Management
- Appointments
- Subscription Management

---

### CareFind

Public healthcare discovery platform.

Core Modules:

- Provider Search
- Medicine Search
- Laboratory Search
- Hospital Directory
- Healthcare Reviews
- Maps & Location
- Appointment Booking (Future)

---

## Testing

Each workspace has its own Vitest setup — run from that directory:

| Area | Command |
|---|---|
| `apps/carehub` | `npm test` |
| `apps/carefind` | `npm test` (or `npm run test:watch`) |
| `packages/shared-marketplace` | `npm test` |
| `packages/shared-notifications` | `npm test` |

Tests verify behavior through public interfaces (integration-style), not implementation details — see `planning/CODE_AUDIT.md` for open audit items.

---

## Engineering Philosophy

This project prioritizes:

- Clean Architecture
- Scalability
- Security
- Maintainability
- Documentation
- Testing
- Developer Experience

Every change should leave the project better than it was before.

---

## Recent QA Cycle — CareFind (2026-09-04)

Consolidated live-testing fixes shipped to `main` (`c1f1140` → `1163a9f`):

- **Facility Discovery & Live Field Intelligence** — Nigeria 37 states / 774 LGAs, 16 categories, progressive radii (no 200m cap), multi-source merge/dedupe, `Smart Facility Discovery` tab (`/dashboard/discovery`) sharing engine with `Live Field Activity`
- **BottomNav 5-nav** — `Home|MedMarket|Create|News|Profile` always visible on mobile (straight flex, `Create` via `CREATE_PATH`)
- **Drawing** — strokes never auto-publish, 1 Post = 1 post (`posting` guard, 12 tests)
- **Video** — 120s/100MB via `probeVideoDuration`+`validateVideoFile`, `VideoPlayer` tap-to-unmute (23 tests)
- **News** — pending → Admin `News (N)` + bell `totalNotifs`, `approve` publishes immediately (25 tests)
- **External sharing** — `share.js` URL-first + `og:url` canonical `og:image` absolute, WhatsApp `vercel.json` (81 tests)
- **Facility actions** — View Profile/Book + per-business product/service search, `booking_interest` notify (9 tests)
- **Rich-text** — heading/colour/decoration `htmlToArticleMarkers` + sanitized paste (50 tests)
- **Multi-image** — 1–5 per post, sixth guard, `image_urls` + `image_url` mirror, carousel (20 tests)
- **News preview** — `cf-eng-row` on preview + comment reliability (26 tests)
- **Scheduled Live** — Upcoming `scheduled_at>now` filter + Past, Manage edit/reschedule/cancel, DELETE RLS (11 tests)
- **Stories** — `useStoryRing` batched, `StoryAvatar` teal/gray ring on 7 surfaces, rail `followed+own`, `StoryViewer` engagement (`story_reactions`/`story_comments` + `get_story_viewers` owner-only)

Builds clean (CareFind 1996 modules, CareHub 301 modules) and ~700+ tests in CareFind, ~800+ in CareHub.