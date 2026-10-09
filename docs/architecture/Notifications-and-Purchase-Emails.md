# CareFind notifications and purchase emails

Status: code written and tested on this branch. **Not yet deployed. The security migration (section 5) is written but not applied to production.**

## 1. What was wrong

1. **Every shop notification began with "Someone".** `notifications` holds two kinds of row and the page treated them as one:
   - *Actor rows*: another member did something to you. Written by the member's browser with `actor_id` set. The stored message is a verb phrase ("liked your post") that completes "`<name>` `<message>`".
   - *System rows*: the platform tells you about your own order or payment. Written by `SECURITY DEFINER` database functions with no actor. The stored message is already a sentence ("Payment confirmed for order CF-000045").

   The page printed `<actor name || 'Someone'>` in front of every message, so every system row read "Someone Payment confirmed for order CF-000045". Status messages also leaked raw keys ("is now ready_for_pickup").
2. **No purchase email left the system.** The settlement engine did run the "payment confirmed" effects, but the email never reached the outbox (section 4).
3. **A forged "platform" notification was possible.** The notifications INSERT policy let any signed-in user write a row with no actor, any type and any link into anyone's inbox (section 5).

## 2. Notifications page

| File | Role |
|---|---|
| `apps/carefind/src/modules/account/notificationPresentation.js` | Pure rules: which voice a row has, its icon and tone, its headline, where it links. No React, no Supabase. |
| `apps/carefind/src/modules/account/Notifications.jsx` | Thin view: loading, error with retry, empty, list. |
| `apps/carefind/src/modules/shop/orderConstants.js` | `formatKobo`, shared with the invoice (it used to be a private copy). |

- **System rows** get a headline of their own ("Payment confirmed", "Order placed", "Refund processed", "Back in stock"...), the stored sentence as the detail, and, for order rows, the order's total and items. They never get a name in front.
- **Actor rows** keep "`<name>` `<message>`". If the actor can no longer be shown (the account was deleted: `actor_id` is `ON DELETE SET NULL`) the row reads "A former member ...". Platform-hosted live invitations read "CareFind ...". Nothing reads "Someone".
- **Order status** is said the way the order page says it: "Order ready for pickup", not "is now ready_for_pickup".
- **Order detail** is one extra query for all visible order rows (`shop_orders` with `shop_order_items`, `.in('id', ids)`), run as the signed-in customer so RLS applies. It is fail-soft: if it fails, rows render without the total and items and a warning is logged.
- **Links.** A row opens its post (for post types with a `post_id`) or its stored link, but only an in-app path is followed (`safeInternalPath`: must start with `/`, not `//` or `/\`, no control characters). An absolute or protocol-relative link, which only a forged row could carry, renders as a row that is not clickable.
- **Accessibility.** A real list (`ul`/`li`), facts in a `dl`, icons are decorative (`aria-hidden`), unread state is not colour alone, and rows that navigate are buttons or links.
- **Mark as read** failing no longer breaks the page: it is logged and the row stays unread.

No schema change was needed: `type`, `message`, `link` and `post_id` carry enough, and the table has no `title`/`data` columns to migrate.

Adding a notification type: add it to `SYSTEM` (platform-written) or `ACTOR` (member-written) in `notificationPresentation.js`. An unknown type is shown, never dropped: as the platform ("Notification") when it has no actor.

## 3. Purchase confirmation email

The confirmation, payment and booking emails are queued by `createSettlementEffects` (`packages/shared-payments/src/effects.js`) when a payment intent settles, exactly once, for the call that settled it. They go to the email outbox (`EmailService.enqueue`), which the cron and the in-request flush deliver through Resend.

## 4. Why the email never arrived, and what was changed

The production cause cannot be proven from the repository (it needs Vercel runtime logs and environment). Three independent causes were found in the code, and each is fixed, so the fix does not depend on which one it was:

| Cause | Fix |
|---|---|
| `EmailService.enqueue` required `EMAIL_FROM`/`RESEND_FROM_EMAIL` and threw when neither was set. The settlement wrapper swallowed the error. | The sender falls back to the app's own sender (`packages/shared-email/src/branding.js`: `CareFind <support@mail.carefind.app>`, `CareHub <support@mail.carefindhub.com>`). Precedence: explicit argument, then environment, then the app default. With no sender and no known app it still refuses. `authEmail.js` reads the same constants, so there is one definition. |
| The shared package cannot resolve `@supabase/supabase-js` from its own folder, so a client created inside it fails. | The service-role client is created by the app (`apps/carefind/api/_lib/emailService.js`, lazy singleton) and **injected** into `EmailService`. The cron endpoint builds its client once and reuses it. |
| The serverless function is frozen when the response is sent. The settlement wrapper queued the email, then kicked off a flush it did not wait for, so the flush often never ran. | The wrapper now awaits the flush, **bounded** (`flushBounded`, 4 s): a slow provider cannot hold the payment response, and a failed or timed-out flush is logged and left to the per-minute cron. Both CareFind and CareHub wrappers use it. |

**Failures are now visible.** A settlement email that cannot be queued writes a row to `email_logs` (`event_type = 'failed'`, `metadata.stage = 'enqueue'`, with the template key and idempotency key; never the recipient address) as well as to the function log. Before, the failure existed only in a log that nobody reads.

```sql
-- Settlement emails that could not be queued (healthy: none)
select created_at, detail, metadata->>'template_key' as template
from public.email_logs
where event_type = 'failed' and metadata->>'stage' = 'enqueue'
order by created_at desc limit 50;
```

**Idempotency** is unchanged: the idempotency key is built from the payment intent, so a webhook retry or a second settle call cannot send the email twice (the effects run only for the call that settled).

### What still has to be true in production (owner actions, not code)

1. **The cron must run.** `email_outbox_cron_carefind_url`, `email_outbox_cron_carehub_url` and `email_outbox_cron_secret` are not set in Supabase Vault (see `Production-Readiness.md` 1.1). Until they are, only the in-request flush delivers mail, and any email that misses it (provider slow, rate-limited) waits for the Vercel cron, which runs **once a day** (`0 2 * * *` for CareFind, `0 0 * * *` for CareHub). That is why the flush after settlement matters, and why the per-minute pg_cron must be switched on.
2. **Vercel environment**: `RESEND_API_KEY` and `CRON_SECRET` present. `EMAIL_FROM`/`RESEND_FROM_EMAIL` is now optional (the app default applies); the sender domain must be verified in Resend.
3. **Product decision**: the catalog events `order_confirmation` and `order_status_update` are `enabled = false` (see `Shop-Flow-Review.md` section 10). The payment confirmation does not consult the catalog, so it is not affected; status-change emails are.
4. **Prove it once**: one Paystack test-mode payment, then `select status, template_key, created_at from public.email_outbox order by created_at desc limit 5;` and the query above.

## 5. Security: the notifications INSERT policy

`supabase/migrations/carefind_20261026_notifications_insert_policy.sql` (F-45 in `Red-Team-Audit.md`).

**The hole.** The live policy "notifications insertable by any logged-in actor" accepts `actor_id = auth.uid() OR actor_id IS NULL`. Any signed-in user could therefore insert a notification into any inbox with no actor, any type, any message and any link. The shop's real notices are written the same way (no actor), so a forged "Payment confirmed" with a phishing link was indistinguishable from a real one. The page now refuses to follow external links (section 2), but the row itself must not be insertable.

**The fix.** A browser may insert a notification only if it names itself as the actor **and** its type is one the browser code writes today (an allowlist: `like, comment, comment_like, reply, repost, follow, profile_view, gift, mention, news_like, news_comment, review, consultation, live_invite`). The default is deny: a new browser-written type needs a migration, and nobody can pose as the platform by choosing `shop_payment`.

**What is unaffected.** All 11 database functions that write notifications are `SECURITY DEFINER`, and the table does not `FORCE` RLS, so they bypass the policy. The API's service role bypasses it. The SELECT and UPDATE (recipient-only) policies are untouched.

**What it would break, and the order that avoids it.** `UserGoLive.jsx` invited co-hosts with no `actor_id`, so under the new policy "Go live" with guests would create the show and then fail on the invitation. The client now sends `actor_id: user.id` (and the invitation says who invited you). **Deploy the client first, then apply the migration.** Both orders were checked against the live database and the code on `main`.

**The migration defends itself.** It finds INSERT policies in `pg_policies` instead of dropping by name (a wrong name is a silent no-op and would leave the hole open), refuses to run if a `FOR ALL` policy exists (it would bypass the restriction), runs in one transaction, and asserts the end state (exactly one INSERT policy, RLS on, recipient SELECT/UPDATE present). The rollback SQL is in the file.

**Residual.** A member can still send another member an ordinary notification (a like, a follow): that is the feature. It always carries the sender's own id. The UPDATE policy is not column-restricted (a recipient can edit the text of their own notification): low impact, not changed here.

## 6. Tests

| Suite | What it proves |
|---|---|
| `notificationPresentation.test.js` (25) | Table-driven over the real live types and messages: no "Someone", status humanised, link safety, unknown types, order facts. |
| `Notifications.test.jsx` (13) | Loading, error and retry, empty, payment row with facts, a single order query, fail-soft enrichment, external links not clickable, list semantics, mark-read including its failure. |
| `UserGoLive.invite.test.jsx` (2) | The invitation carries `actor_id`. |
| `notificationsInsertPolicy.db.test.js` (PGlite, 14) | The hole exists before the migration; afterwards a member can write each browser type as themselves and nothing else; DEFINER functions and the service role still work; inboxes stay private; idempotent; a leftover differently-named policy is removed; a `FOR ALL` policy makes it refuse. |
| `shared-email` `EmailService.test.js` | Sender fallback, precedence, refusal. |
| `shared-payments` `effects.test.js` | Enqueue failure recorded without the address; `flushBounded` waits, bounds a hang, swallows errors. |
| `api/_lib/__tests__/emailService.test.js`, `settlementEffects.test.js` | Client injected and built once; flush awaited; a hanging flush is bounded; a queue failure reaches `email_logs`; nothing sent when not settled. |

## 7. Not done here (found, deliberately left)

- CareCoin consultation, subscription and auto-renew events produce no notification or email.
- The unread badge is not refreshed live and the list is not paginated.
- `record_shop_notification` is dead code (execute revoked in F-43); remove it in a cleanup migration.
- The notifications UPDATE policy is not column-restricted (section 5).
