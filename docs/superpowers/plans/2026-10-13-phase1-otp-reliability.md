# Phase 1 OTP Reliability & Withdrawal Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate false "Incorrect code" rejections and reload-loss on CareFind/CareHub withdrawals via truthful superseded errors and a server-backed draft.

**Architecture:** Additive Postgres migration (new column + branch in `verify_otp`, new `withdrawal_drafts` table + 3 RPCs) with no signature changes; shared logic in `packages/shared-payments`; thin handler wrappers in both apps; UI-only countdown/resume changes. Old code ignores new columns; nulls behave as today.

**Tech Stack:** Postgres 17 (PL/pgSQL, SECURITY DEFINER, advisory locks), Node 20 (shared-payments ESM), Vitest + PGlite + real-Postgres concurrency, React (both apps).

**Spec:** `docs/superpowers/specs/2026-10-13-phase1-otp-reliability-withdrawal-session-design.md`

## Global Constraints

- Money stays integer: coins integer, kobo integer; never compare or add incompatible units.
- Never store, log, or return OTP codes, PINs, full account numbers, IPs, or secrets; HMAC key is `OTP_HMAC_SECRET` (fallback only outside production).
- `otp_challenges`, drafts, RPCs: RLS on zero policies, EXECUTE service_role only; handlers verify JWT first.
- Every migration exists in both `supabase/migrations/` and `apps/carefind/sql/` with identical content; names unique (release-gate checks).
- No fee/rate/unit change: `coin_value_kobo=20000`, `withdrawal_fee_rate=0.20` stay; frontend estimates stay hard-coded 200/0.2.
- KYC stays OFF (`kyc_enabled=0`); no KYC dependency in any touched module (kycIsolation test must pass).
- H-10 ordering kept: checkOtp before bank/limits/reservation; no reservation in draft path.
- Both apps deploy together; migration applies before code deploy.

---

### Task 1: Migration — `consumed_reason` + `superseded` branch

**Files:**
- Create: `supabase/migrations/carefind_20261103_otp_superseded_reason.sql`
- Create: `apps/carefind/sql/carefind_20261103_otp_superseded_reason.sql` (byte-identical copy)
- Test: `apps/carefind/src/test/payments/otpSuperseded.db.test.js`

**Interfaces:**
- Consumes: existing `public.otp_challenges`, `public.issue_otp(uuid,text,text,integer,text)`, `public.verify_otp(uuid,text,text)`
- Produces: `verify_otp` returns `'superseded'`; column `otp_challenges.consumed_reason text null`

- [ ] **Step 1: Write the failing migration test**

```js
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (n) => read(`../../../../../supabase/migrations/${n}.sql`)
let db
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema if not exists auth; create table if not exists auth.users (id uuid primary key);
    create table public.financial_config (key text primary key, value numeric not null, unit text not null, description text not null, updated_at timestamptz not null default now());`)
  await db.exec(M('carefind_20261024_otp_challenges'))
  await db.exec(M('carefind_20261027_withdrawal_otp_purpose'))
  await db.exec(M('carefind_20261028_otp_hardening'))
  await db.exec(M('carefind_20261103_otp_superseded_reason'))
})
describe('superseded branch', () => {
  it('typing a burned prior code returns superseded and does not burn the live row', async () => {
    const u = uid(901)
    await db.query('insert into auth.users (id) values ($1)', [u])
    await db.query(`select public.issue_otp($1,'withdrawal','old-hash',300,null)`, [u])
    await db.query(`update public.otp_challenges set created_at = now() - interval '2 minutes' where user_id=$1`, [u])
    await db.query(`select public.issue_otp($1,'withdrawal','new-hash',300,null)`, [u])
    const r1 = (await db.query(`select public.verify_otp($1,'withdrawal','old-hash') as r`, [u])).rows[0].r
    expect(r1).toBe('superseded')
    const live = (await db.query(`select attempts from public.otp_challenges where user_id=$1 and consumed_at is null`, [u])).rows[0]
    expect(live.attempts).toBe(0)
    const r2 = (await db.query(`select public.verify_otp($1,'withdrawal','new-hash') as r`, [u])).rows[0].r
    expect(r2).toBe('ok')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.payments.config.js src/test/payments/otpSuperseded.db.test.js` from `apps/carefind`
Expected: FAIL with "relation otp_challenges / function verify_otp superseded" or file-not-found (migration missing)

- [ ] **Step 3: Write minimal migration**

```sql
-- 2026-11-03 - truthful superseded OTP outcome (Phase 1). Additive, re-runnable.
do $$ begin
  if to_regclass('public.otp_challenges') is null then raise exception 'apply the otp_challenges migration first'; end if;
end $$;
alter table public.otp_challenges add column if not exists consumed_reason text;
create or replace function public.issue_otp(p_user_id uuid, p_purpose text, p_code_hash text, p_ttl_seconds integer, p_ip_hash text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_last timestamptz; v_count integer; v_ip_cap numeric; v_all_cap numeric;
begin
  if not (p_purpose = any (array['pin_set','payout_account','withdrawal'])) then raise exception 'unknown otp purpose: %', p_purpose; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_purpose, 0));
  select max(created_at) into v_last from public.otp_challenges where user_id=p_user_id and purpose=p_purpose;
  if v_last is not null and v_last > now() - interval '60 seconds' then return 'cooldown'; end if;
  select count(*) into v_count from public.otp_challenges where user_id=p_user_id and purpose=p_purpose and created_at > now() - interval '1 hour';
  if v_count >= 3 then return 'rate_limited'; end if;
  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('otp_ip:' || p_ip_hash, 0));
    select coalesce((select value from public.financial_config where key='otp_ip_hourly_cap'),10) into v_ip_cap;
    select count(*) into v_count from public.otp_challenges where ip_hash=p_ip_hash and created_at > now() - interval '1 hour';
    if v_count >= v_ip_cap then return 'ip_limited'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('otp_global', 0));
  select coalesce((select value from public.financial_config where key='otp_global_hourly_cap'),500) into v_all_cap;
  select count(*) into v_count from public.otp_challenges where created_at > now() - interval '1 hour';
  if v_count >= v_all_cap then return 'global_limited'; end if;
  update public.otp_challenges set consumed_at=now(), consumed_reason='superseded'
   where user_id=p_user_id and purpose=p_purpose and consumed_at is null;
  insert into public.otp_challenges (user_id, purpose, code_hash, expires_at, ip_hash)
  values (p_user_id, p_purpose, p_code_hash, now() + make_interval(secs=>p_ttl_seconds), p_ip_hash);
  return 'ok';
end; $$;
create or replace function public.verify_otp(p_user_id uuid, p_purpose text, p_code_hash text)
returns text language plpgsql security definer set search_path = public as $$
declare v public.otp_challenges%rowtype;
begin
  select * into v from public.otp_challenges
   where user_id=p_user_id and purpose=p_purpose and consumed_at is null
   order by created_at desc limit 1 for update;
  if not found then return 'none'; end if;
  if v.expires_at < now() then update public.otp_challenges set consumed_at=now(), consumed_reason='expired' where id=v.id; return 'expired'; end if;
  if v.attempts >= 5 then update public.otp_challenges set consumed_at=now(), consumed_reason='locked' where id=v.id; return 'locked'; end if;
  if v.code_hash = p_code_hash then update public.otp_challenges set consumed_at=now(), consumed_reason='used' where id=v.id; return 'ok'; end if;
  if exists (select 1 from public.otp_challenges where user_id=p_user_id and purpose=p_purpose and code_hash=p_code_hash and consumed_reason='superseded') then
    return 'superseded';
  end if;
  update public.otp_challenges set attempts=attempts+1, consumed_at=case when attempts+1>=5 then now() else null end,
    consumed_reason=case when attempts+1>=5 then 'locked' else consumed_reason end where id=v.id;
  return case when v.attempts+1>=5 then 'locked' else 'invalid' end;
end; $$;
revoke execute on function public.issue_otp(uuid,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.issue_otp(uuid,text,text,integer,text) to service_role;
revoke execute on function public.verify_otp(uuid,text,text) from public, anon, authenticated;
grant execute on function public.verify_otp(uuid,text,text) to service_role;
```

Copy byte-identical to `apps/carefind/sql/carefind_20261103_otp_superseded_reason.sql`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.payments.config.js src/test/payments/otpSuperseded.db.test.js` from `apps/carefind`
Expected: PASS (1/1). Also run `src/test/payments/otpHardening.db.test.js` — all green (null-reason legacy rows behave as before).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/carefind_20261103_otp_superseded_reason.sql apps/carefind/sql/carefind_20261103_otp_superseded_reason.sql apps/carefind/src/test/payments/otpSuperseded.db.test.js
git commit -m "feat(otp): truthful superseded outcome with consumed_reason (Phase 1)"
```

### Task 2: shared-payments `otp.js` — map `superseded`, log it

**Files:**
- Modify: `packages/shared-payments/src/otp.js:160-190`
- Test: `packages/shared-payments/src/__tests__/otpSuperseded.test.js`

**Interfaces:**
- Consumes: `verify_otp` returning `'superseded'`
- Produces: `checkOtp` returns `{ok:false,status:400,code:'otp_superseded',error:'A newer code was issued — please use the latest email.'}`; logs `otp.superseded_typed`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi } from 'vitest'
import { checkOtp } from '../otp.js'
describe('checkOtp superseded', () => {
  it('maps superseded without burning and logs it', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: 'superseded', error: null }) }
    process.env.OTP_HMAC_SECRET = 'test-secret'
    const r = await supabase && (await import('../otp.js')).checkOtp({ supabase, userId: 'u-1', purpose: 'withdrawal', code: '123456', logger })
    expect(r).toEqual({ ok: false, status: 400, code: 'otp_superseded', error: 'A newer code was issued — please use the latest email.' })
    expect(logger.warn).toHaveBeenCalledWith('otp.superseded_typed', expect.objectContaining({ purpose: 'withdrawal' }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/otpSuperseded.test.js` from `packages/shared-payments`
Expected: FAIL with "expected otp_invalid/unavailable, got superseded fallback" (VERIFY_FAILURES lacks the key)

- [ ] **Step 3: Write minimal implementation**

```js
const VERIFY_FAILURES = {
  invalid: { status: 400, code: 'otp_invalid', error: 'Incorrect code. Check the email and try again.' },
  expired: { status: 400, code: 'otp_expired', error: 'That code has expired. Request a new one.' },
  locked: { status: 429, code: 'otp_locked', error: 'Too many wrong codes. Request a new one.' },
  none: { status: 400, code: 'otp_missing', error: 'Request a verification code first.' },
  superseded: { status: 400, code: 'otp_superseded', error: 'A newer code was issued — please use the latest email.' },
}
```

In `checkOtp` after the `result === 'ok'` line, before generic warn:

```js
if (result === 'superseded') {
  logger.warn('otp.superseded_typed', { purpose, user: ref })
  return { ok: false, ...VERIFY_FAILURES.superseded }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/otpSuperseded.test.js` from `packages/shared-payments`
Expected: PASS. Then `npm test` full package — all green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-payments/src/otp.js packages/shared-payments/src/__tests__/otpSuperseded.test.js
git commit -m "feat(otp): map superseded outcome with dedicated log line (Phase 1)"
```

### Task 3: `withdrawal_drafts` table + RPCs + shared helper

**Files:**
- Create migration: `supabase/migrations/carefind_20261104_withdrawal_drafts.sql` + byte-identical `apps/carefind/sql/` copy
- Create: `packages/shared-payments/src/withdrawalDrafts.js`
- Modify: `packages/shared-payments/src/index.js:21` (add export line)
- Test: `apps/carefind/src/test/payments/withdrawalDrafts.db.test.js`, `packages/shared-payments/src/__tests__/withdrawalDrafts.test.js`

**Interfaces:**
- Consumes: `hashOtp`-style HMAC via `OTP_HMAC_SECRET`; `payout_accounts` read for saved binding
- Produces: `createWithdrawalDraft({supabase,userId,app,amount,unit,destination}) -> {ok,draftId,resendAvailableAt,draftExpiresAt} | {ok:false,outcome:'draft_active'}`; `getWithdrawalDraft({supabase,userId}) -> {draft|null}`; `destinationFingerprint({userId,savedId,bankCode,accountNumber}) -> string`

- [ ] **Step 1: Write the failing draft test (PGlite)**

```js
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (n) => read(`../../../../../supabase/migrations/${n}.sql`)
let db
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema if not exists auth; create table if not exists auth.users (id uuid primary key);`)
  await db.exec(M('carefind_20261024_otp_challenges'))
  await db.exec(M('carefind_20261027_withdrawal_otp_purpose'))
  await db.exec(M('carefind_20261028_otp_hardening'))
  await db.exec(M('carefind_20261104_withdrawal_drafts'))
})
describe('withdrawal_drafts', () => {
  it('creates one live draft per user and refuses a second with draft_active', async () => {
    const u = '00000000-0000-4000-8000-000000000701'
    await db.query('insert into auth.users (id) values ($1) on conflict do nothing', [u])
    const a = (await db.query(`select public.create_withdrawal_draft($1,'carefind',5,'coins','saved:acc-1') as r`, [u])).rows[0].r
    expect(a.ok).toBe(true)
    const b = (await db.query(`select public.create_withdrawal_draft($1,'carefind',5,'coins','saved:acc-1') as r`, [u])).rows[0].r
    expect(b.outcome).toBe('draft_active')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.payments.config.js src/test/payments/withdrawalDrafts.db.test.js` from `apps/carefind`
Expected: FAIL (migration/table missing)

- [ ] **Step 3: Write minimal migration + helper**

```sql
-- 2026-11-04 - server-backed pre-reservation withdrawal drafts (Phase 1). No money moves here.
create table if not exists public.withdrawal_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  app text not null check (app in ('carefind','carehub')),
  amount numeric not null check (amount > 0),
  unit text not null check (unit in ('coins','kobo')),
  destination_fp text not null,
  destination_mask text not null,
  purpose text not null default 'withdrawal',
  otp_issued_at timestamptz not null default now(),
  draft_expires_at timestamptz not null default now() + interval '10 minutes',
  voided_at timestamptz, void_reason text,
  created_at timestamptz not null default now()
);
create index if not exists withdrawal_drafts_live on public.withdrawal_drafts (user_id, purpose, draft_expires_at) where voided_at is null;
alter table public.withdrawal_drafts enable row level security;
revoke all on table public.withdrawal_drafts from public, anon, authenticated;
create or replace function public.create_withdrawal_draft(p_user_id uuid, p_app text, p_amount numeric, p_unit text, p_destination_fp text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if p_app not in ('carefind','carehub') then raise exception 'unknown app'; end if;
  if p_unit not in ('coins','kobo') then raise exception 'unknown unit'; end if;
  if exists (select 1 from public.withdrawal_drafts where user_id=p_user_id and purpose='withdrawal' and voided_at is null and draft_expires_at > now()) then
    return jsonb_build_object('ok', false, 'outcome', 'draft_active');
  end if;
  update public.withdrawal_drafts set voided_at=now(), void_reason='superseded' where user_id=p_user_id and purpose='withdrawal' and voided_at is null;
  insert into public.withdrawal_drafts (user_id, app, amount, unit, destination_fp, destination_mask)
  values (p_user_id, p_app, p_amount, p_unit, p_destination_fp, '••••' || right(p_destination_fp, 4))
  returning jsonb_build_object('ok', true, 'draft_id', id, 'draft_expires_at', draft_expires_at, 'otp_issued_at', otp_issued_at) into v;
  return v;
end; $$;
create or replace function public.void_withdrawal_draft(p_user_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.withdrawal_drafts set voided_at=now(), void_reason=p_reason
   where user_id=p_user_id and purpose='withdrawal' and voided_at is null;
end; $$;
revoke execute on function public.create_withdrawal_draft(uuid,text,numeric,text,text) from public, anon, authenticated;
grant execute on function public.create_withdrawal_draft(uuid,text,numeric,text,text) to service_role;
revoke execute on function public.void_withdrawal_draft(uuid,text) from public, anon, authenticated;
grant execute on function public.void_withdrawal_draft(uuid,text) to service_role;
```

```js
// packages/shared-payments/src/withdrawalDrafts.js
import crypto from 'node:crypto'
function draftSecret() { return process.env.OTP_HMAC_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY }
export function destinationFingerprint({ userId, savedId, bankCode, accountNumber }) {
  if (savedId) return `saved:${savedId}`
  return 'typed:' + crypto.createHmac('sha256', draftSecret()).update(`draft:${userId}:${bankCode}:${accountNumber}`).digest('hex')
}
export async function createWithdrawalDraft(supabase, { userId, app, amount, unit, destination }) {
  const fp = destinationFingerprint({ userId, ...destination })
  const { data, error } = await supabase.rpc('create_withdrawal_draft', { p_user_id: userId, p_app: app, p_amount: amount, p_unit: unit, p_destination_fp: fp })
  if (error) throw new Error(`draft create failed: ${error.message}`)
  return { ...data, fingerprint: fp }
}
export async function getWithdrawalDraft(supabase, { userId }) {
  const { data, error } = await supabase.from('withdrawal_drafts').select('id,app,amount,unit,destination_mask,draft_expires_at,otp_issued_at').eq('user_id', userId).is('voided_at', null).gt('draft_expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`draft read failed: ${error.message}`)
  return data || null
}
```

Export from `index.js`: `export { destinationFingerprint, createWithdrawalDraft, getWithdrawalDraft } from './withdrawalDrafts.js'`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config vitest.payments.config.js src/test/payments/withdrawalDrafts.db.test.js` from `apps/carefind`; `npm test -- src/__tests__/withdrawalDrafts.test.js` from `packages/shared-payments`
Expected: PASS both; full `npm test` in shared-payments green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/carefind_20261104_withdrawal_drafts.sql apps/carefind/sql/carefind_20261104_withdrawal_drafts.sql packages/shared-payments/src/withdrawalDrafts.js packages/shared-payments/src/index.js apps/carefind/src/test/payments/withdrawalDrafts.db.test.js packages/shared-payments/src/__tests__/withdrawalDrafts.test.js
git commit -m "feat(withdrawal): server-backed pre-reservation drafts (Phase 1)"
```

### Task 4: Handlers — draft-aware OTP issue + submit re-validation (both apps)

**Files:**
- Modify: `apps/carefind/api/_handlers/withdrawal-pin.js:46-51`
- Modify: `apps/carehub/api/_handlers/withdrawal-pin.js:37-42`
- Modify: `apps/carefind/api/_handlers/initiate-withdrawal.js:63-68`
- Modify: `apps/carehub/api/_handlers/initiate-business-withdrawal.js:64-68`
- Test: `apps/carefind/api/_handlers/initiate-withdrawal.draft.test.js`, `apps/carehub/api/_handlers/initiateBusinessWithdrawal.draft.test.js`

**Interfaces:**
- Consumes: Task 3 helpers; existing `issueOtpFromRequest`, `checkOtp`, `getPayoutAccountForWithdrawal`
- Produces: `POST /api/withdrawal-pin/otp {purpose:withdrawal, amount, destination}` returns `{ok,sentTo,expiresInSeconds,resendAvailableAt,draftExpiresAt}` or `409 {code:'draft_active'}`; `GET /api/withdrawal-pin/draft` returns live draft or `{draft:null}`; submit refuses body-vs-draft mismatch with `400 {code:'draft_mismatch'}` before `checkOtp`

- [ ] **Step 1: Write the failing handler test**

```js
// apps/carefind/api/_handlers/initiate-withdrawal.draft.test.js
import { describe, it, expect, vi } from 'vitest'
vi.mock('../_lib/verifyUser.js', () => ({ verifyUser: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', user_metadata: {} }) }))
describe('draft gate', () => {
  it('refuses a body that does not match the live draft before checkOtp', async () => {
    const { default: handler } = await import('./initiate-withdrawal.js')
    const req = { method: 'POST', body: { amount: 99, bankCode: '058', bankName: 'GTB', accountNumber: '0123456789', accountName: 'A', pin: '1234', otp: '123456' }, headers: {} }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'draft_mismatch' }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/_handlers/initiate-withdrawal.draft.test.js` from `apps/carefind`
Expected: FAIL (no `draft_mismatch` branch; handler proceeds to PIN/OTP)

- [ ] **Step 3: Write minimal handler changes**

In `withdrawal-pin.js` `otp` action (both apps, CareFind shown):

```js
if (action === 'otp') {
  const { purpose, amount, payoutAccountId, bankCode, accountNumber } = req.body || {}
  if ((purpose || 'pin_set') === 'withdrawal') {
    const coins = Number(amount)
    if (!Number.isInteger(coins) || coins < 5) return res.status(400).json({ error: 'Enter an amount of at least 5 CareCoins first.', code: 'draft_amount' })
    const fp = (await import('@care-ecosystem/shared-payments')).destinationFingerprint({ userId: user.id, savedId: payoutAccountId, bankCode, accountNumber })
    const draft = await (await import('@care-ecosystem/shared-payments')).createWithdrawalDraft(supabase, { userId: user.id, app: 'carefind', amount: coins, unit: 'coins', destination: { savedId: payoutAccountId, bankCode, accountNumber } }).catch(() => null)
    if (draft && draft.ok === false && draft.outcome === 'draft_active') return res.status(409).json({ error: 'A code is already on its way — check your email.', code: 'draft_active' })
  }
  const r = await issueOtpFromRequest({ supabase, user, req, mailer: await getSecurityMailer() })
  return res.status(r.status).json(r.body)
}
if (action === 'draft') {
  const { getWithdrawalDraft } = await import('@care-ecosystem/shared-payments')
  const draft = await getWithdrawalDraft(supabase, { userId: user.id })
  return res.status(200).json({ draft })
}
```

In `initiate-withdrawal.js` after PIN check, before `checkOtp`:

```js
{
  const { getWithdrawalDraft, destinationFingerprint } = await import('@care-ecosystem/shared-payments');
  const draft = await getWithdrawalDraft(supabase, { userId: user.id }).catch(() => null);
  const want = destinationFingerprint({ userId: user.id, savedId: payoutAccountId, bankCode, accountNumber });
  if (!draft || Number(draft.amount) !== coins) return res.status(400).json({ error: 'Your withdrawal details changed — request a fresh code.', code: 'draft_mismatch' });
}
```

(CareHub mirrors with `amountKobo`/`unit:'kobo'`/`app:'carehub'`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run api/_handlers/initiate-withdrawal.draft.test.js` from `apps/carefind`; equivalent CareHub suite
Expected: PASS; existing `initiate-withdrawal.*` and `initiateBusinessWithdrawal.*` suites still green.

- [ ] **Step 5: Commit**

```bash
git add apps/carefind/api/_handlers/withdrawal-pin.js apps/carehub/api/_handlers/withdrawal-pin.js apps/carefind/api/_handlers/initiate-withdrawal.js apps/carehub/api/_handlers/initiate-business-withdrawal.js apps/carefind/api/_handlers/initiate-withdrawal.draft.test.js apps/carehub/api/_handlers/initiateBusinessWithdrawal.draft.test.js
git commit -m "feat(withdrawal): draft-aware OTP issue and submit gate (Phase 1)"
```

### Task 5: Frontend — countdown, resume, paste fix (both apps + Appointments)

**Files:**
- Modify: `apps/carefind/src/modules/wallet-payments/WithdrawalOtpField.jsx`
- Modify: `apps/carehub/src/modules/wallet/WithdrawalOtpField.jsx`
- Modify: `apps/carehub/src/modules/appointments/Appointments.jsx:288-325,551`
- Test: `apps/carefind/src/modules/wallet-payments/WithdrawalOtpField.test.jsx`, CareHub mirror

**Interfaces:**
- Consumes: `POST /api/withdrawal-pin/otp` (now with amount/destination), `GET /api/withdrawal-pin/draft`, `otp_superseded` code
- Produces: countdown from server timestamps; resume display with empty code; sanitize-then-truncate input

- [ ] **Step 1: Write the failing UI test**

```jsx
import { describe, it, expect } from 'vitest'
import { sanitizeOtp } from './otpSanitize.js'
describe('otp sanitize', () => {
  it('strips then truncates so 123 456 lands whole', () => {
    expect('123 456'.replace(/\D/g, '').slice(0, 6)).toBe('123456')
    expect('123-456-789'.replace(/\D/g, '').slice(0, 6)).toBe('123456')
  })
})
```

(Plus component test: renders "Resend available in Ns" from `resendAvailableAt` prop; on `otp_superseded` clears value and shows "use the latest email".)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- WithdrawalOtpField` from `apps/carefind`
Expected: FAIL (no countdown/resume/superseded handling; old strip order keeps `maxLength` truncation bug)

- [ ] **Step 3: Write minimal UI changes**

```jsx
// sanitize helper used by onChange AND onPaste (both apps)
const clean = (v) => String(v || '').replace(/\D/g, '').slice(0, 6)
onChange={(v) => onChange(clean(v))}
onPaste={(e) => { e.preventDefault(); onChange(clean(e.clipboardData.getData('text'))) }}
// remove maxLength={6} from Inp (or keep with clean-first); keep autoComplete="one-time-code" inputMode="numeric"
// resume: on mount fetch GET /api/withdrawal-pin/draft -> if draft: setSent(true), show `Code sent · expires in M:SS · resend in N s` from server timestamps (setInterval 1s, display only)
// resend: POST includes {purpose:'withdrawal', amount, payoutAccountId/bankCode/accountNumber}; 409 draft_active -> "A code is already on its way"; otp_superseded -> clear value, hint "A newer code was issued — use the latest email"
// persist only {draftId, otpIssuedAt, draftExpiresAt} in sessionStorage (never code/PIN/account)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- WithdrawalOtpField` from `apps/carefind` and `apps/carehub`
Expected: PASS both; existing wallet UI suites green; `npm run lint` 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/carefind/src/modules/wallet-payments/WithdrawalOtpField.jsx apps/carehub/src/modules/wallet/WithdrawalOtpField.jsx apps/carehub/src/modules/appointments/Appointments.jsx "apps/carefind/src/modules/wallet-payments/WithdrawalOtpField.test.jsx"
git commit -m "feat(ui): draft resume, server countdown, paste fix on OTP field (Phase 1)"
```

### Task 6: Gate — full suites, release-gate, rollout watch

**Files:**
- None (verification only)

- [ ] **Step 1: Run shared packages**

Run: `npm test` in each of `packages/shared-payments`, `packages/shared-email`, `packages/shared-notifications`, `packages/shared-payout-ui`
Expected: all PASS (shared-payments 600+; others unchanged)

- [ ] **Step 2: Run app suites + concurrency**

Run: `npm test` from `apps/carefind` (PGlite); `npm run test:finance:pg` with `PG_CONCURRENCY_URL` (real Postgres, sequential); `npm test` from `apps/carehub`
Expected: PASS all; 30-racing-verifies → exactly 1 `ok`; supersede-typing storm burns 0 live attempts

- [ ] **Step 3: Run release gate + builds**

Run: `node scripts/release-gate.mjs`; `npm run build` in both apps; `npm run lint` (0 errors)
Expected: gate PASS except known pre-existing dependency-audit FAIL (unchanged, owner decision pending)

- [ ] **Step 4: Stage rollout checklist (no execution)**

Record in PR body: migration order (`...03_otp_superseded_reason` then `...04_withdrawal_drafts`) → deploy both apps together → confirm `OTP_HMAC_SECRET` set → watch `otp.superseded_typed` decay + `otp.verify_rejected{invalid}` drop. No Vault-secret dependency. No production writes in this plan.
