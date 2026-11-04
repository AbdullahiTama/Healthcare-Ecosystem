-- Importer & manufacturer operating models: Centralised and Decentralised, representative ledgers and statements,
-- and switching between the two models in either direction.
-- 2027-01-02 (sequence date). Spec: "CareHub | Importer & Manufacturer Operating Structures" (owner, 2026-11-02).
-- Design: docs/architecture/Importer-Operating-Models.md
--
-- Status: APPLIED 2026-11-04 to production (szdybxmgmhndoytqanfb) in seven parts, split at the section boundaries
-- (migration history: carehub_20270102_importer_operating_models_1_columns, _2_ledger, _3_accounts_stock,
-- _4_recording, _5_statements, _6_switching, _7_locations_grants). Verified: md5 of every one of the 48 function
-- bodies in production equals this file loaded on PGlite; a rolled-back probe as the owner of a real importer passed
-- (docs/architecture/Importer-Operating-Models.md §10); security advisor shows nothing new.
--
-- PROBLEM
--   A manufacturer/importer runs its sales representatives in one of two ways, and CareHub supported only one:
--   reps were staff of the company and nothing recorded what each rep owed for goods given to them on credit.
--   The rep_* tables (rep_company_entries, rep_customer_entries, rep_peer_entries) are empty, have no application
--   code, store a product name instead of a product, and move no stock; they are left untouched by this migration.
--
-- WHAT THIS DOES
--   1. businesses.operating_model ('centralised' | 'decentralised') on a top-level manufacturer_importer, and
--      businesses.account_kind ('business' | 'rep_account'). Existing importers become 'centralised', which is
--      exactly how they run today (reps are staff of the company). Neither column can be written by the browser.
--   2. A representative's independent account (Decentralised) is a child business of the company with
--      account_kind = 'rep_account'. It reuses every existing module (POS, inventory, stock ledger, purchases,
--      reports, field activity, discovery) unchanged, because those already work per business. The rep is the
--      account's staff member with role 'Owner'; current_business_ids() gives staff exactly one business, so a rep
--      never reaches the company's or another rep's records. The company owner keeps oversight through the tree.
--   3. A representative account is never public: its businesses row is forced off CareFind (listing, shop,
--      booking), its products are forced to list_on_carefind = false, and it cannot list on the online store.
--      The company's own account stays the public catalogue under both models.
--   4. company_representatives: one row per representative, stable across model switches. It points at the
--      person's staff row (which moves between the company and the rep account; its id never changes) and at their
--      rep account (kept when dormant, reused when the company switches back, so no duplicates).
--   5. rep_ledger_entries + rep_ledger_lines: the representative's account with the company, append-only.
--      supply (debit), payment (credit), return (credit, accepted value), transfer_out (credit to the sender) /
--      transfer_in (debit to the receiver), adjustment (debit or credit, reason + reference required) and
--      reversal (the mirror of one posted entry). Returns and transfers may be recorded 'pending' and approved or
--      rejected later. Only 'posted' entries count. Balance > 0 means the rep owes the company.
--   6. Stock, per model (the design note explains why):
--        Decentralised: a supply moves stock from the company to the rep account through apply_stock_change
--          (creating the rep's product from the company product when needed); an accepted return moves it back
--          (good condition restocks the company; damaged or expired leaves the rep account only); a transfer moves
--          it between the two rep accounts.
--        Centralised: reps sell through the company's central POS and inventory, so stock stays in the company's
--          count. A supply records the goods in the rep's custody (rep_custody); a good return reduces custody; a
--          damaged or expired return reduces custody and writes the goods off the company's stock; a transfer
--          moves custody between reps.
--      A reversal undoes the stock effect of the entry it reverses, and is refused once the company has changed
--      operating model since that entry (record an adjustment instead).
--   7. rep_statement(rep, from, to): opening balance (everything posted before the period), every posted entry in
--      the period in date order with a running balance, closing balance, totals by type and pending items. The
--      summary and detailed statements are two views of this one result. rep_ledger_summary(company, from, to):
--      the same figures for every representative, for consolidated reports.
--   8. operating_model_preview(company, target) and switch_operating_model(company, target, token, stock plan,
--      note): the migration summary (representatives, balances, custody or rep stock, pending items, blockers and
--      warnings) and the switch itself, in one transaction, refused when anything changed since the preview.
--      operating_model_changes records every change (append-only), audit_log records who did it.
--   9. set_registration_operating_model(email, model): service role only, called by /api/register-business. A new
--      importer is created Centralised by default (businesses_operating_model_guard) and this records the choice.
--  10. rep_ledger_register(company, from, to, rep, type, product, territory): the company's transaction register with
--      every filter of spec 7 and the audit trail of each entry (recorded by, approved or rejected by, what it
--      reverses, what reversed it). company_representatives.territory_id (set_representative_territory) is the
--      representative's location for reports; rep_ledger_summary takes the same territory filter.
--  11. A switch reconciles before and after (operating_model_reconciliation: ledger entries, pending entries, each
--      representative's balance, stock units by master item across the company and every rep account, stock value at
--      company cost) and raises on any difference, which rolls the whole switch back (spec 9.2, 9.4). Open field
--      orders in a rep account block a switch to Centralised; open company orders a rep raised and customers' unpaid
--      credit in a rep account are listed as warnings. Company staff who manage or view representative accounts are
--      notified with the owner and the representatives.
--  12. Representative accounts do not count as locations against the plan (guard_business_insert and
--      business_billing_overview, re-created from their live definitions with that one change).
--
-- SECURITY
--   * Every write is a SECURITY DEFINER function with a pinned search_path that checks the caller explicitly:
--     recording and approving need the owner, a platform admin or a role with canManageRepLedger; reading needs
--     canViewRepLedger (or manage), or being that representative (own statement only). Switching needs the company
--     owner or a platform admin. Direct INSERT/UPDATE/DELETE on the new tables is revoked; the ledger is
--     append-only (a trigger refuses DELETE and any UPDATE other than deciding a pending entry inside the
--     functions).
--   * Moving a staff row between the company and a rep account happens only inside switch_operating_model /
--     add_company_representative (current_user is the function owner, which guard_staff_writes trusts, as for
--     remove_staff_member). The staff id, email, login and invitation columns never change.
--   * New SELECT policy "rep account members read their account" lets a rep read their own rep account's
--     businesses row (needed to sign in; branch staff cannot read a non-public branch row today). It is limited to
--     account_kind = 'rep_account' rows the caller is a member of.
--   * Widening: none for other tenants. Within a company, a rep can read only their own representative row,
--     ledger, custody and the company's product catalogue (rep_company_catalog: names, prices, no stock or cost).
--
-- ROLLBACK
--   Re-apply guard_business_insert from carehub_20261214_plan_enforcement.sql and business_billing_overview from
--   carehub_20261218_subscription_billing.sql (both only gain the rep-account filter here).
--   Before any switch has happened: drop the functions, triggers, policy and tables added here, then
--   alter table businesses drop column operating_model, drop column operating_model_changed_at,
--   drop column account_kind. After a switch to Decentralised, first switch every company back to Centralised
--   (which moves each rep back to company staff) so no rep account is left with a staff member in it.

-- ── 1. Operating model columns ─────────────────────────────────────────────────────────────────────────────────────
alter table public.businesses
  add column if not exists operating_model text,
  add column if not exists operating_model_changed_at timestamptz,
  add column if not exists account_kind text not null default 'business';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'businesses_operating_model_check') then
    alter table public.businesses add constraint businesses_operating_model_check
      check (operating_model is null or (operating_model in ('centralised', 'decentralised') and parent_business_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'businesses_account_kind_check') then
    alter table public.businesses add constraint businesses_account_kind_check
      check (account_kind in ('business', 'rep_account') and (account_kind = 'business' or parent_business_id is not null));
  end if;
end $$;

-- Today's importers already run centrally: representatives are staff of the company.
update public.businesses set operating_model = 'centralised'
 where operating_model is null and parent_business_id is null and business_type = 'manufacturer_importer';

-- The browser can never set these columns; only the functions below (and server code) can. A representative
-- account is forced off every public CareFind surface whoever writes it.
create or replace function public.businesses_operating_model_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.operating_model is not null or coalesce(new.account_kind, 'business') <> 'business'
         or new.operating_model_changed_at is not null then
        raise exception 'The operating model and representative accounts are set by CareHub, not directly.' using errcode = '42501';
      end if;
    elsif new.operating_model is distinct from old.operating_model
       or new.account_kind is distinct from old.account_kind
       or new.operating_model_changed_at is distinct from old.operating_model_changed_at then
      raise exception 'Change the operating model from Settings > Operating model.' using errcode = '42501';
    end if;
  end if;
  -- Every top-level importer has a model: one registered without a choice (or retyped later) starts Centralised,
  -- which is how importers worked before this migration. The owner's choice at registration replaces it.
  if new.parent_business_id is null and new.business_type = 'manufacturer_importer' and new.operating_model is null then
    new.operating_model := 'centralised';
  end if;
  if new.account_kind = 'rep_account' then
    new.visible_on_carefind := false;
    new.ecommerce_enabled := false;
    new.booking_enabled := false;
  end if;
  return new;
end $$;
drop trigger if exists businesses_operating_model_guard on public.businesses;
create trigger businesses_operating_model_guard before insert or update on public.businesses
  for each row execute function public.businesses_operating_model_guard();

create or replace function public.is_rep_account(p_business_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select account_kind = 'rep_account' from public.businesses where id = p_business_id), false)
$$;

-- A representative's private stock and prices never become public. SECURITY DEFINER: a rep cannot read the
-- businesses row of their account under RLS in every path, and the check must not depend on who is asking.
create or replace function public.products_rep_account_not_public()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(new.list_on_carefind, false) and public.is_rep_account(new.business_id) then
    new.list_on_carefind := false;
  end if;
  return new;
end $$;
drop trigger if exists products_rep_account_not_public on public.products;
create trigger products_rep_account_not_public before insert or update of list_on_carefind, business_id on public.products
  for each row execute function public.products_rep_account_not_public();

create or replace function public.ecommerce_products_rep_account_refused()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.is_rep_account(new.business_id) then
    raise exception 'A representative account cannot list products on the CareFind online store. The company''s account is the public catalogue.'
      using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists ecommerce_products_rep_account_refused on public.ecommerce_products;
create trigger ecommerce_products_rep_account_refused before insert or update of business_id on public.ecommerce_products
  for each row execute function public.ecommerce_products_rep_account_refused();

drop policy if exists "rep account members read their account" on public.businesses;
create policy "rep account members read their account" on public.businesses for select to authenticated
  using (account_kind = 'rep_account' and id in (select public.current_business_ids()));

-- ── 2. Representatives ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.company_representatives (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.businesses(id),
  staff_id              uuid references public.staff(id) on delete set null,
  rep_account_id        uuid references public.businesses(id),
  full_name             text not null check (length(btrim(full_name)) > 0),
  email                 text,
  rep_code              text not null,
  company_role          text,
  status                text not null default 'active' check (status in ('active', 'inactive')),
  account_dormant_since timestamptz,
  -- The representative's sales territory (spec 7: reports filter by location). Optional; set by a ledger manager.
  territory_id          uuid references public.territories(id) on delete set null,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  created_by_name       text,
  unique (company_id, rep_code)
);
create unique index if not exists company_representatives_staff on public.company_representatives (staff_id) where staff_id is not null;
create unique index if not exists company_representatives_account on public.company_representatives (rep_account_id) where rep_account_id is not null;
create index if not exists company_representatives_company on public.company_representatives (company_id, status);
create index if not exists company_representatives_territory on public.company_representatives (territory_id) where territory_id is not null;

-- ── 3. The ledger ──────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.rep_ledger_entries (
  id                             uuid primary key default gen_random_uuid(),
  company_id                     uuid not null references public.businesses(id),
  representative_id              uuid not null references public.company_representatives(id),
  entry_no                       text not null unique,
  entry_type                     text not null check (entry_type in ('supply', 'payment', 'return', 'transfer_out', 'transfer_in', 'adjustment', 'reversal')),
  status                         text not null default 'posted' check (status in ('pending', 'posted', 'rejected')),
  entry_date                     date not null,
  debit                          numeric(14,2) not null default 0 check (debit >= 0),
  credit                         numeric(14,2) not null default 0 check (credit >= 0),
  description                    text not null,
  reference                      text,
  reason                         text,
  note                           text,
  payment_method                 text check (payment_method is null or payment_method in ('cash', 'bank_transfer', 'pos', 'cheque', 'mobile_money', 'other')),
  payment_recipient              text,
  return_condition               text check (return_condition is null or return_condition in ('good', 'damaged', 'expired')),
  counterparty_representative_id uuid references public.company_representatives(id),
  transfer_group                 uuid,
  reverses_entry_id              uuid references public.rep_ledger_entries(id),
  operating_model                text not null check (operating_model in ('centralised', 'decentralised')),
  stock_effect                   text not null default 'none' check (stock_effect in ('none', 'custody', 'moved')),
  idempotency_key                text,
  created_by                     uuid,
  created_by_name                text,
  created_at                     timestamptz not null default now(),
  decided_by                     uuid,
  decided_by_name                text,
  decided_at                     timestamptz,
  decision_note                  text,
  constraint rep_ledger_one_side check (debit = 0 or credit = 0)
);
create unique index if not exists rep_ledger_entries_idem on public.rep_ledger_entries (company_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists rep_ledger_entries_reverses on public.rep_ledger_entries (reverses_entry_id) where reverses_entry_id is not null;
create index if not exists rep_ledger_entries_rep_date on public.rep_ledger_entries (representative_id, entry_date, created_at);
create index if not exists rep_ledger_entries_company_date on public.rep_ledger_entries (company_id, entry_date);
create index if not exists rep_ledger_entries_pending on public.rep_ledger_entries (company_id) where status = 'pending';

-- Product ids are kept as plain values (no foreign key): a deleted product must not rewrite ledger history.
create table if not exists public.rep_ledger_lines (
  id                 uuid primary key default gen_random_uuid(),
  entry_id           uuid not null references public.rep_ledger_entries(id),
  company_product_id uuid,
  master_product_id  uuid,
  rep_product_id     uuid,
  product_name       text not null,
  quantity           integer not null check (quantity > 0),
  unit_value         numeric(14,2) not null check (unit_value >= 0),
  line_value         numeric(14,2) not null check (line_value >= 0),
  created_at         timestamptz not null default now()
);
create index if not exists rep_ledger_lines_entry on public.rep_ledger_lines (entry_id);

-- Goods in a representative's hands under the Centralised model (they still count in the company's stock).
create table if not exists public.rep_custody (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.businesses(id),
  representative_id  uuid not null references public.company_representatives(id),
  company_product_id uuid not null,
  product_name       text not null,
  quantity           integer not null default 0 check (quantity >= 0),
  updated_at         timestamptz not null default now(),
  unique (representative_id, company_product_id)
);

create table if not exists public.operating_model_changes (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.businesses(id),
  from_model        text check (from_model is null or from_model in ('centralised', 'decentralised')),
  to_model          text not null check (to_model in ('centralised', 'decentralised')),
  effective_at      timestamptz not null default now(),
  initiated_by      uuid,
  initiated_by_name text,
  summary           jsonb not null default '{}'::jsonb,
  result            jsonb not null default '{}'::jsonb,
  exceptions        jsonb not null default '[]'::jsonb,
  note              text
);
create index if not exists operating_model_changes_company on public.operating_model_changes (company_id, effective_at desc);

-- Append-only: history is corrected with a new entry (a reversal or an adjustment), never by editing. Inside the
-- functions (carehub.rep_ledger_authority = 'on') a pending entry may be decided, and nothing that identifies it
-- may change. One guard per table: a PL/pgSQL expression cannot name a column the other table lacks.
create or replace function public.rep_ledger_entries_append_only()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(current_setting('carehub.rep_ledger_authority', true), '') = 'on'
     and old.status = 'pending' and new.status in ('pending', 'posted', 'rejected')
     and (new.id, new.company_id, new.representative_id, new.entry_no, new.entry_type, new.entry_date, new.reference,
          new.reason, new.counterparty_representative_id, new.transfer_group, new.reverses_entry_id, new.operating_model,
          new.created_by, new.created_at, new.idempotency_key)
         is not distinct from
         (old.id, old.company_id, old.representative_id, old.entry_no, old.entry_type, old.entry_date, old.reference,
          old.reason, old.counterparty_representative_id, old.transfer_group, old.reverses_entry_id, old.operating_model,
          old.created_by, old.created_at, old.idempotency_key) then
    return new;
  end if;
  raise exception 'The representative ledger is append-only: record a reversal or an adjustment instead.' using errcode = '42501';
end $$;

-- Deciding a pending return may set a line's accepted value; a supply or transfer records the rep's product.
create or replace function public.rep_ledger_lines_append_only()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(current_setting('carehub.rep_ledger_authority', true), '') = 'on'
     and (new.id, new.entry_id, new.company_product_id, new.product_name, new.quantity)
         is not distinct from (old.id, old.entry_id, old.company_product_id, old.product_name, old.quantity) then
    return new;
  end if;
  raise exception 'The representative ledger is append-only: record a reversal or an adjustment instead.' using errcode = '42501';
end $$;
drop trigger if exists rep_ledger_entries_append_only on public.rep_ledger_entries;
create trigger rep_ledger_entries_append_only before update or delete on public.rep_ledger_entries
  for each row execute function public.rep_ledger_entries_append_only();
drop trigger if exists rep_ledger_lines_append_only on public.rep_ledger_lines;
create trigger rep_ledger_lines_append_only before update or delete on public.rep_ledger_lines
  for each row execute function public.rep_ledger_lines_append_only();

create or replace function public.operating_model_changes_append_only()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'Operating model history cannot be changed.' using errcode = '42501';
end $$;
drop trigger if exists operating_model_changes_append_only on public.operating_model_changes;
create trigger operating_model_changes_append_only before update or delete on public.operating_model_changes
  for each row execute function public.operating_model_changes_append_only();

-- ── 4. Who may do what ─────────────────────────────────────────────────────────────────────────────────────────────
-- p_level 'manage': record, approve, reverse. 'view': read every representative's ledger and statements.
create or replace function public.rep_ledger_can(p_company uuid, p_level text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (
    public.is_platform_admin()
    or public.is_business_owner_email(auth.email(), p_company)
    or exists (
      select 1 from public.staff s join public.roles r on r.business_id = s.business_id and r.name = s.role
       where s.business_id = p_company and lower(s.email) = lower(auth.email()) and s.status = 'active'
         and ((r.permissions ->> 'canManageRepLedger') = 'true'
              or (p_level = 'view' and (r.permissions ->> 'canViewRepLedger') = 'true'))))
$$;

-- The signed-in person's active representative row, in either model (their staff row moves, its id does not).
create or replace function public.caller_representative_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select r.id from public.company_representatives r join public.staff s on s.id = r.staff_id
   where lower(s.email) = lower(auth.email()) and s.status = 'active' and r.status = 'active'
   limit 1
$$;

create or replace function public.rep_ledger_actor_name(p_company uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select s.full_name from public.staff s where lower(s.email) = lower(auth.email()) and s.status = 'active' limit 1),
    (select b.owner from public.businesses b where b.id = p_company and lower(b.email) = lower(auth.email())),
    auth.email(), 'CareHub')
$$;

-- The company's current model; refuses anything that is not a top-level importer/manufacturer using the models.
create or replace function public.operating_company_model(p_company uuid)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_model text;
begin
  select operating_model into v_model from public.businesses
   where id = p_company and parent_business_id is null and business_type = 'manufacturer_importer' and deleted_at is null;
  if v_model is null then
    raise exception 'Operating models apply to a registered importer or manufacturer account.' using errcode = '22023';
  end if;
  return v_model;
end $$;

create or replace function public.rep_ledger_require(p_company uuid, p_level text)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_model text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to continue.' using errcode = '42501';
  end if;
  v_model := public.operating_company_model(p_company);
  if not public.rep_ledger_can(p_company, p_level) then
    raise exception 'You do not have permission to % representative accounts for this company.',
      case when p_level = 'manage' then 'record or approve entries on' else 'view' end using errcode = '42501';
  end if;
  return v_model;
end $$;

create or replace function public.rep_balance(p_representative_id uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(debit - credit), 0)::numeric(14,2) from public.rep_ledger_entries
   where representative_id = p_representative_id and status = 'posted'
$$;

create or replace function public.rep_ledger_audit(p_company uuid, p_action text, p_target uuid, p_metadata jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.audit_log (actor_id, actor_type, branch_id, action, target_type, target_id, metadata)
  values (auth.uid(),
          case when public.is_platform_admin() then 'platform_admin'
               when public.is_business_owner_email(auth.email(), p_company) then 'owner' else 'staff' end,
          p_company, p_action, 'rep_ledger', p_target, coalesce(p_metadata, '{}'::jsonb));
end $$;

-- ── 5. Reads under RLS ─────────────────────────────────────────────────────────────────────────────────────────────
alter table public.company_representatives enable row level security;
alter table public.rep_ledger_entries enable row level security;
alter table public.rep_ledger_lines enable row level security;
alter table public.rep_custody enable row level security;
alter table public.operating_model_changes enable row level security;

drop policy if exists "representatives visible to ledger viewers and themselves" on public.company_representatives;
create policy "representatives visible to ledger viewers and themselves" on public.company_representatives for select to authenticated
  using (public.rep_ledger_can(company_id, 'view') or id = public.caller_representative_id());
drop policy if exists "ledger visible to viewers and the representative" on public.rep_ledger_entries;
create policy "ledger visible to viewers and the representative" on public.rep_ledger_entries for select to authenticated
  using (public.rep_ledger_can(company_id, 'view') or representative_id = public.caller_representative_id());
drop policy if exists "ledger lines visible with their entry" on public.rep_ledger_lines;
create policy "ledger lines visible with their entry" on public.rep_ledger_lines for select to authenticated
  using (entry_id in (select e.id from public.rep_ledger_entries e));
drop policy if exists "custody visible to viewers and the representative" on public.rep_custody;
create policy "custody visible to viewers and the representative" on public.rep_custody for select to authenticated
  using (public.rep_ledger_can(company_id, 'view') or representative_id = public.caller_representative_id());
drop policy if exists "model history visible to ledger viewers" on public.operating_model_changes;
create policy "model history visible to ledger viewers" on public.operating_model_changes for select to authenticated
  using (public.rep_ledger_can(company_id, 'view'));

revoke all on public.company_representatives, public.rep_ledger_entries, public.rep_ledger_lines, public.rep_custody,
  public.operating_model_changes from anon, authenticated;
grant select on public.company_representatives, public.rep_ledger_entries, public.rep_ledger_lines, public.rep_custody,
  public.operating_model_changes to authenticated;
grant all on public.company_representatives, public.rep_ledger_entries, public.rep_ledger_lines, public.rep_custody,
  public.operating_model_changes to service_role;

-- ── 6. Representative accounts (Decentralised) and moving a person between the structures ─────────────────────────
-- The rep account for a representative: the dormant one when it exists (no duplicates), else a new child business.
create or replace function public.rep_account_open(p_rep_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.company_representatives%rowtype; c public.businesses%rowtype; v_id uuid;
begin
  select * into r from public.company_representatives where id = p_rep_id for update;
  select * into c from public.businesses where id = r.company_id;
  if r.rep_account_id is not null then
    update public.company_representatives set account_dormant_since = null where id = r.id;
    return r.rep_account_id;
  end if;
  insert into public.businesses (name, owner, branch_name, parent_business_id, account_kind, business_type, status, plan,
                                 plan_expires_at, state, city, lga, area, address, branch_depth_limit, visible_on_carefind)
  values (c.name || ' · ' || r.full_name, r.full_name, r.full_name, c.id, 'rep_account', c.business_type, 'active', c.plan,
          c.plan_expires_at, c.state, c.city, c.lga, c.area, c.address, 0, false)
  returning id into v_id;
  update public.company_representatives set rep_account_id = v_id, account_dormant_since = null where id = r.id;
  return v_id;
end $$;

-- Company staff -> the independent account's owner. The staff id, email and login are unchanged.
create or replace function public.rep_move_to_account(p_rep_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.company_representatives%rowtype; s public.staff%rowtype; v_account uuid;
begin
  select * into r from public.company_representatives where id = p_rep_id for update;
  select * into s from public.staff where id = r.staff_id for update;
  if not found or s.status <> 'active' then
    raise exception '% needs an active CareHub login before they can run their own account.', r.full_name using errcode = '22023';
  end if;
  v_account := public.rep_account_open(r.id);
  update public.company_representatives set company_role = case when s.business_id = r.company_id then s.role else company_role end
   where id = r.id;
  update public.staff set business_id = v_account, role = 'Owner' where id = s.id;
  insert into public.staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
  values (v_account, s.id, false, 'operating_model_changed', 'Your representative account is ready',
          'You now run your own account: your own POS, stock, prices and records. Sign out and back in to open it.',
          '/dashboard');
  return v_account;
end $$;

-- The independent account's owner -> company staff, with the role they had before (or 'Representative').
create or replace function public.rep_move_to_company(p_rep_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.company_representatives%rowtype; s public.staff%rowtype; v_role text;
begin
  select * into r from public.company_representatives where id = p_rep_id for update;
  v_role := coalesce(nullif(btrim(r.company_role), ''), 'Representative');
  if v_role = 'Representative' and not exists (select 1 from public.roles where business_id = r.company_id and name = 'Representative') then
    insert into public.roles (business_id, name, permissions)
    values (r.company_id, 'Representative', jsonb_build_object(
      'nav', jsonb_build_array('dashboard', 'pos', 'clients', 'activity', 'orders', 'messages', 'discovery'),
      'canMakeSales', true, 'canViewReports', false, 'canEditPrice', false, 'canEditStock', false,
      'label', 'Representative'));
  end if;
  select * into s from public.staff where id = r.staff_id for update;
  if found and s.business_id is distinct from r.company_id then
    update public.staff set business_id = r.company_id, role = v_role where id = s.id;
    insert into public.staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
    values (r.company_id, s.id, false, 'operating_model_changed', 'You now work in the company account',
            'Your company has moved to central operation: you sell through the company POS and stock. Your own account''s history is kept. Sign out and back in.',
            '/dashboard');
  end if;
  if r.rep_account_id is not null then
    update public.company_representatives set account_dormant_since = now() where id = r.id;
  end if;
end $$;

create or replace function public.add_company_representative(p_company uuid, p_staff_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_model text; s public.staff%rowtype; v_id uuid; v_code text; v_n integer; v_account uuid;
begin
  v_model := public.rep_ledger_require(p_company, 'manage');
  perform 1 from public.businesses where id = p_company for update;
  select * into s from public.staff where id = p_staff_id and business_id = p_company;
  if not found then
    raise exception 'Choose a staff member of this company.' using errcode = '22023';
  end if;
  if s.status = 'inactive' then
    raise exception '% is inactive. Reactivate them on the Staff page first.', s.full_name using errcode = '22023';
  end if;
  if exists (select 1 from public.company_representatives where staff_id = s.id) then
    raise exception '% is already a representative.', s.full_name using errcode = '22023';
  end if;
  select count(*) + 1 into v_n from public.company_representatives where company_id = p_company;
  v_code := 'REP-' || lpad(v_n::text, 3, '0');
  while exists (select 1 from public.company_representatives where company_id = p_company and rep_code = v_code) loop
    v_n := v_n + 1; v_code := 'REP-' || lpad(v_n::text, 3, '0');
  end loop;
  insert into public.company_representatives (company_id, staff_id, full_name, email, rep_code, company_role, created_by, created_by_name)
  values (p_company, s.id, s.full_name, lower(s.email), v_code, s.role, auth.uid(), public.rep_ledger_actor_name(p_company))
  returning id into v_id;
  if v_model = 'decentralised' then
    v_account := public.rep_move_to_account(v_id);
  end if;
  perform public.rep_ledger_audit(p_company, 'representative.added', v_id,
    jsonb_build_object('staff_id', s.id, 'rep_code', v_code, 'operating_model', v_model, 'rep_account_id', v_account));
  return jsonb_build_object('id', v_id, 'rep_code', v_code, 'rep_account_id', v_account);
end $$;

create or replace function public.set_representative_status(p_representative_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.company_representatives%rowtype;
begin
  select * into r from public.company_representatives where id = p_representative_id for update;
  if not found then raise exception 'Representative not found.' using errcode = 'P0002'; end if;
  perform public.rep_ledger_require(r.company_id, 'manage');
  if p_status not in ('active', 'inactive') then
    raise exception 'Status must be active or inactive.' using errcode = '22023';
  end if;
  update public.company_representatives set status = p_status where id = r.id;
  perform public.rep_ledger_audit(r.company_id, 'representative.' || p_status, r.id, jsonb_build_object('from', r.status));
end $$;

-- The representative's territory (one of the company's own territories), or null to clear it.
create or replace function public.set_representative_territory(p_representative_id uuid, p_territory_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.company_representatives%rowtype;
begin
  select * into r from public.company_representatives where id = p_representative_id for update;
  if not found then raise exception 'Representative not found.' using errcode = 'P0002'; end if;
  perform public.rep_ledger_require(r.company_id, 'manage');
  if p_territory_id is not null and not exists (select 1 from public.territories t where t.id = p_territory_id and t.business_id = r.company_id) then
    raise exception 'Choose one of your company''s territories.' using errcode = '22023';
  end if;
  update public.company_representatives set territory_id = p_territory_id where id = r.id;
  perform public.rep_ledger_audit(r.company_id, 'representative.territory', r.id,
    jsonb_build_object('from', r.territory_id, 'to', p_territory_id));
end $$;

-- ── 7. Stock effects ───────────────────────────────────────────────────────────────────────────────────────────────
-- The rep account's product for a company product (same master item), created from the company product if needed.
-- New rep products start at the company's price, which the representative may change; they are never public.
create or replace function public.rep_account_product(p_account uuid, p_company_product uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare cp public.products%rowtype; v_id uuid;
begin
  select * into cp from public.products where id = p_company_product;
  if cp.master_product_id is null then
    raise exception '% is not linked to the master catalogue, so it cannot move to a representative account. Link it in Master Catalog first.', cp.name
      using errcode = '22023';
  end if;
  select id into v_id from public.products where business_id = p_account and master_product_id = cp.master_product_id
   order by coalesce(stock, 0) desc, id limit 1 for update;
  if v_id is null then
    insert into public.products (business_id, master_product_id, name, generic_name, category, price, cost_price, stock,
                                 reorder_level, barcode, sale_type, list_on_carefind, emoji, rx_status, price_source)
    values (p_account, cp.master_product_id, cp.name, cp.generic_name, cp.category, coalesce(cp.price, 0),
            coalesce(cp.cost_price, 0), 0, coalesce(cp.reorder_level, 5), cp.barcode, coalesce(cp.sale_type, 'retail'),
            false, cp.emoji, cp.rx_status, 'branch')
    returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.rep_custody_add(p_company uuid, p_rep uuid, p_product uuid, p_name text, p_delta integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_have integer; v_rep_name text;
begin
  insert into public.rep_custody (company_id, representative_id, company_product_id, product_name, quantity)
  values (p_company, p_rep, p_product, p_name, 0)
  on conflict (representative_id, company_product_id) do nothing;
  select quantity into v_have from public.rep_custody where representative_id = p_rep and company_product_id = p_product for update;
  if v_have + p_delta < 0 then
    select full_name into v_rep_name from public.company_representatives where id = p_rep;
    raise exception '% holds only % of % on their account.', v_rep_name, v_have, p_name using errcode = '22023';
  end if;
  update public.rep_custody set quantity = quantity + p_delta, product_name = p_name, updated_at = now()
   where representative_id = p_rep and company_product_id = p_product;
end $$;

-- Applies (p_sign = 1) or undoes (p_sign = -1) the stock effect of one entry's lines. Transfers carry their stock on
-- the transfer_out entry only. Keys make every movement replay-safe.
create or replace function public.rep_entry_apply_stock(p_entry_id uuid, p_sign integer)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e public.rep_ledger_entries%rowtype; l public.rep_ledger_lines%rowtype; cp public.products%rowtype;
  v_rep public.company_representatives%rowtype; v_other public.company_representatives%rowtype;
  v_rep_prod uuid; v_other_prod uuid; v_q integer; v_tag text; v_mt text; v_src text; v_effect text := 'none';
begin
  select * into e from public.rep_ledger_entries where id = p_entry_id;
  if e.entry_type not in ('supply', 'return', 'transfer_out') then return 'none'; end if;
  select * into v_rep from public.company_representatives where id = e.representative_id;
  if e.entry_type = 'transfer_out' then
    select * into v_other from public.company_representatives where id = e.counterparty_representative_id;
  end if;
  v_tag := case when p_sign = 1 then '' else ':rev' end;
  v_src := 'rep_' || case e.entry_type when 'transfer_out' then 'transfer' else e.entry_type end || case when p_sign = 1 then '' else '_reversal' end;

  for l in select * from public.rep_ledger_lines where entry_id = e.id order by created_at, id loop
    v_q := l.quantity * p_sign;
    select * into cp from public.products where id = l.company_product_id and business_id = e.company_id;
    if not found then
      raise exception '% is no longer in the company''s products, so its stock cannot move. Record an adjustment instead.', l.product_name
        using errcode = '22023';
    end if;
    if cp.tracking_mode <> 'none' then
      raise exception '% is tracked by batch, so it cannot move to or from a representative yet.', cp.name using errcode = '22023';
    end if;

    if e.operating_model = 'decentralised' then
      v_effect := 'moved';
      if v_rep.rep_account_id is null or (e.entry_type = 'transfer_out' and v_other.rep_account_id is null) then
        raise exception 'This representative has no account yet.' using errcode = '22023';
      end if;
      v_mt := case when p_sign = 1 then 'transfer' else 'correction' end;
      if e.entry_type = 'supply' then
        v_rep_prod := public.rep_account_product(v_rep.rep_account_id, cp.id);
        perform public.apply_stock_change(e.company_id, cp.id, -v_q, v_mt, null, v_src, e.id::text, l.id::text,
          'To ' || v_rep.full_name || ' · ' || e.entry_no, 'rep:' || e.id || ':' || l.id || ':company' || v_tag, null);
        perform public.apply_stock_change(v_rep.rep_account_id, v_rep_prod, v_q, v_mt, null, v_src, e.id::text, l.id::text,
          'From the company · ' || e.entry_no, 'rep:' || e.id || ':' || l.id || ':rep' || v_tag, null);
      elsif e.entry_type = 'return' then
        v_rep_prod := public.rep_account_product(v_rep.rep_account_id, cp.id);
        perform public.apply_stock_change(v_rep.rep_account_id, v_rep_prod, -v_q, v_mt, null, v_src, e.id::text, l.id::text,
          'Returned to the company (' || e.return_condition || ') · ' || e.entry_no, 'rep:' || e.id || ':' || l.id || ':rep' || v_tag, null);
        if e.return_condition = 'good' then
          perform public.apply_stock_change(e.company_id, cp.id, v_q, case when p_sign = 1 then 'return_restock' else 'correction' end,
            null, v_src, e.id::text, l.id::text, 'Returned by ' || v_rep.full_name || ' · ' || e.entry_no,
            'rep:' || e.id || ':' || l.id || ':company' || v_tag, null);
        end if;
      else
        v_rep_prod := public.rep_account_product(v_rep.rep_account_id, cp.id);
        v_other_prod := public.rep_account_product(v_other.rep_account_id, cp.id);
        perform public.apply_stock_change(v_rep.rep_account_id, v_rep_prod, -v_q, v_mt, null, v_src, e.id::text, l.id::text,
          'To ' || v_other.full_name || ' · ' || e.entry_no, 'rep:' || e.id || ':' || l.id || ':sender' || v_tag, null);
        perform public.apply_stock_change(v_other.rep_account_id, v_other_prod, v_q, v_mt, null, v_src, e.id::text, l.id::text,
          'From ' || v_rep.full_name || ' · ' || e.entry_no, 'rep:' || e.id || ':' || l.id || ':receiver' || v_tag, null);
      end if;
      if p_sign = 1 and l.rep_product_id is null then
        perform set_config('carehub.rep_ledger_authority', 'on', true);
        update public.rep_ledger_lines set rep_product_id = v_rep_prod where id = l.id;
        perform set_config('carehub.rep_ledger_authority', '', true);
      end if;
    else
      v_effect := 'custody';
      if e.entry_type = 'supply' then
        perform public.rep_custody_add(e.company_id, v_rep.id, cp.id, cp.name, v_q);
      elsif e.entry_type = 'return' then
        perform public.rep_custody_add(e.company_id, v_rep.id, cp.id, cp.name, -v_q);
        if e.return_condition <> 'good' then
          perform public.apply_stock_change(e.company_id, cp.id, -v_q, case when p_sign = 1 then 'write_off' else 'correction' end,
            null, v_src, e.id::text, l.id::text, 'Returned ' || e.return_condition || ' by ' || v_rep.full_name || ' · ' || e.entry_no,
            'rep:' || e.id || ':' || l.id || ':company' || v_tag, null);
        end if;
      else
        perform public.rep_custody_add(e.company_id, v_rep.id, cp.id, cp.name, -v_q);
        perform public.rep_custody_add(e.company_id, v_other.id, cp.id, cp.name, v_q);
      end if;
    end if;
  end loop;
  return v_effect;
end $$;

-- ── 8. Recording ───────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.rep_ledger_new_entry_no()
returns text language sql volatile set search_path = public, pg_temp as $$
  select 'RL-' || to_char(now() at time zone 'Africa/Lagos', 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 6))
$$;

create or replace function public.rep_ledger_check_date(p_date date)
returns date language plpgsql stable set search_path = public, pg_temp as $$
declare v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  if p_date is null then return v_today; end if;
  if p_date > v_today then
    raise exception 'An entry cannot be dated in the future.' using errcode = '22023';
  end if;
  return p_date;
end $$;

create or replace function public.rep_ledger_active_rep(p_company uuid, p_rep uuid)
returns public.company_representatives language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.company_representatives%rowtype;
begin
  select * into r from public.company_representatives where id = p_rep and company_id = p_company;
  if not found then raise exception 'Representative not found.' using errcode = 'P0002'; end if;
  if r.status <> 'active' then
    raise exception '% is inactive. Reactivate them to record new entries.', r.full_name using errcode = '22023';
  end if;
  return r;
end $$;

-- Validates product lines [{product_id, qty, unit_value}] against the company's products and inserts them.
-- Returns the total value.
create or replace function public.rep_ledger_insert_lines(p_company uuid, p_entry_id uuid, p_lines jsonb)
returns numeric language plpgsql security definer set search_path = public, pg_temp as $$
declare v_line jsonb; v_pid uuid; v_qty integer; v_unit numeric; cp public.products%rowtype; v_total numeric := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one product.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 200 then
    raise exception 'An entry can hold up to 200 products. Split it into two.' using errcode = '22023';
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    begin
      v_pid := (v_line ->> 'product_id')::uuid;
      v_qty := (v_line ->> 'qty')::integer;
      v_unit := round(coalesce((v_line ->> 'unit_value')::numeric, -1), 2);
    exception when others then
      raise exception 'Each product needs a whole-number quantity and a value.' using errcode = '22023';
    end;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantities must be greater than zero.' using errcode = '22023'; end if;
    if v_unit < 0 then raise exception 'Each product needs a value of zero or more.' using errcode = '22023'; end if;
    select * into cp from public.products where id = v_pid and business_id = p_company;
    if not found then raise exception 'A product in this entry is not one of the company''s products.' using errcode = '22023'; end if;
    if exists (select 1 from public.rep_ledger_lines where entry_id = p_entry_id and company_product_id = cp.id) then
      raise exception '% is listed twice. Combine the quantities.', cp.name using errcode = '22023';
    end if;
    insert into public.rep_ledger_lines (entry_id, company_product_id, master_product_id, product_name, quantity, unit_value, line_value)
    values (p_entry_id, cp.id, cp.master_product_id, cp.name, v_qty, v_unit, round(v_qty * v_unit, 2));
    v_total := v_total + round(v_qty * v_unit, 2);
  end loop;
  return v_total;
end $$;

create or replace function public.rep_ledger_replay(p_company uuid, p_key text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', e.id, 'entry_no', e.entry_no, 'status', e.status, 'replayed', true,
                            'balance', public.rep_balance(e.representative_id))
    from public.rep_ledger_entries e where e.company_id = p_company and e.idempotency_key = p_key and p_key is not null
$$;

-- Entries whose amount depends on their lines are inserted as 'pending' with zero amounts, then finalised here.
-- This is the only path that turns a freshly inserted pending row into a posted one with its amounts.
create or replace function public.rep_ledger_finalise(p_entry_id uuid, p_debit numeric, p_credit numeric, p_effect text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform set_config('carehub.rep_ledger_authority', 'on', true);
  update public.rep_ledger_entries set debit = round(p_debit, 2), credit = round(p_credit, 2), stock_effect = coalesce(p_effect, 'none'),
         status = 'posted', decided_by = coalesce(decided_by, auth.uid()), decided_at = coalesce(decided_at, now()),
         decided_by_name = coalesce(decided_by_name, public.rep_ledger_actor_name(company_id))
   where id = p_entry_id;
  perform set_config('carehub.rep_ledger_authority', '', true);
end $$;

create or replace function public.record_rep_supply(p_company uuid, p_representative_id uuid, p_lines jsonb,
  p_entry_date date default null, p_reference text default null, p_note text default null, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_model text; r public.company_representatives%rowtype; v_id uuid; v_no text; v_total numeric; v_effect text; v_replay jsonb;
begin
  v_model := public.rep_ledger_require(p_company, 'manage');
  v_replay := public.rep_ledger_replay(p_company, p_idempotency_key);
  if v_replay is not null then return v_replay; end if;
  r := public.rep_ledger_active_rep(p_company, p_representative_id);
  v_no := public.rep_ledger_new_entry_no();
  insert into public.rep_ledger_entries (company_id, representative_id, entry_no, entry_type, status, entry_date, description,
    reference, note, operating_model, idempotency_key, created_by, created_by_name)
  values (p_company, r.id, v_no, 'supply', 'pending', public.rep_ledger_check_date(p_entry_date), 'Products supplied on credit',
    nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), v_model, p_idempotency_key, auth.uid(), public.rep_ledger_actor_name(p_company))
  returning id into v_id;
  v_total := public.rep_ledger_insert_lines(p_company, v_id, p_lines);
  v_effect := public.rep_entry_apply_stock(v_id, 1);
  perform public.rep_ledger_finalise(v_id, v_total, 0, v_effect);
  perform public.rep_ledger_audit(p_company, 'rep_ledger.supply', v_id, jsonb_build_object('entry_no', v_no, 'value', v_total, 'representative_id', r.id));
  return jsonb_build_object('id', v_id, 'entry_no', v_no, 'status', 'posted', 'value', v_total, 'balance', public.rep_balance(r.id));
end $$;

create or replace function public.record_rep_payment(p_company uuid, p_representative_id uuid, p_amount numeric, p_method text,
  p_recipient text, p_entry_date date default null, p_reference text default null, p_note text default null, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_model text; r public.company_representatives%rowtype; v_id uuid; v_no text; v_replay jsonb;
begin
  v_model := public.rep_ledger_require(p_company, 'manage');
  v_replay := public.rep_ledger_replay(p_company, p_idempotency_key);
  if v_replay is not null then return v_replay; end if;
  r := public.rep_ledger_active_rep(p_company, p_representative_id);
  if p_amount is null or round(p_amount, 2) <= 0 then raise exception 'Enter an amount greater than zero.' using errcode = '22023'; end if;
  if nullif(btrim(p_recipient), '') is null then raise exception 'Record who received the payment.' using errcode = '22023'; end if;
  v_no := public.rep_ledger_new_entry_no();
  insert into public.rep_ledger_entries (company_id, representative_id, entry_no, entry_type, status, entry_date, credit, description,
    reference, note, payment_method, payment_recipient, operating_model, idempotency_key, created_by, created_by_name, decided_by, decided_at)
  values (p_company, r.id, v_no, 'payment', 'posted', public.rep_ledger_check_date(p_entry_date), round(p_amount, 2), 'Payment received',
    nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), coalesce(p_method, 'cash'), btrim(p_recipient), v_model, p_idempotency_key,
    auth.uid(), public.rep_ledger_actor_name(p_company), auth.uid(), now())
  returning id into v_id;
  perform public.rep_ledger_audit(p_company, 'rep_ledger.payment', v_id, jsonb_build_object('entry_no', v_no, 'amount', round(p_amount, 2)));
  return jsonb_build_object('id', v_id, 'entry_no', v_no, 'status', 'posted', 'value', round(p_amount, 2), 'balance', public.rep_balance(r.id));
end $$;

-- p_accept = true posts the return now (the caller is the approver); false records it as awaiting approval.
create or replace function public.record_rep_return(p_company uuid, p_representative_id uuid, p_lines jsonb, p_condition text,
  p_accept boolean default true, p_entry_date date default null, p_reference text default null, p_note text default null,
  p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_model text; r public.company_representatives%rowtype; v_id uuid; v_no text; v_total numeric; v_replay jsonb; v_effect text;
begin
  v_model := public.rep_ledger_require(p_company, 'manage');
  v_replay := public.rep_ledger_replay(p_company, p_idempotency_key);
  if v_replay is not null then return v_replay; end if;
  r := public.rep_ledger_active_rep(p_company, p_representative_id);
  if p_condition is null or p_condition not in ('good', 'damaged', 'expired') then
    raise exception 'Choose the condition of the returned goods: good, damaged or expired.' using errcode = '22023';
  end if;
  v_no := public.rep_ledger_new_entry_no();
  insert into public.rep_ledger_entries (company_id, representative_id, entry_no, entry_type, status, entry_date, description,
    reference, note, return_condition, operating_model, idempotency_key, created_by, created_by_name)
  values (p_company, r.id, v_no, 'return', 'pending', public.rep_ledger_check_date(p_entry_date), 'Products returned (' || p_condition || ')',
    nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), p_condition, v_model, p_idempotency_key, auth.uid(), public.rep_ledger_actor_name(p_company))
  returning id into v_id;
  v_total := public.rep_ledger_insert_lines(p_company, v_id, p_lines);
  if coalesce(p_accept, true) then
    v_effect := public.rep_entry_apply_stock(v_id, 1);
    perform public.rep_ledger_finalise(v_id, 0, v_total, v_effect);
  end if;
  perform public.rep_ledger_audit(p_company, 'rep_ledger.return', v_id,
    jsonb_build_object('entry_no', v_no, 'value', v_total, 'condition', p_condition, 'accepted', coalesce(p_accept, true)));
  return jsonb_build_object('id', v_id, 'entry_no', v_no, 'status', case when coalesce(p_accept, true) then 'posted' else 'pending' end,
                            'value', v_total, 'balance', public.rep_balance(r.id));
end $$;

-- A transfer is two entries sharing transfer_group: transfer_out credits the sender, transfer_in debits the receiver.
create or replace function public.record_rep_transfer(p_company uuid, p_from_representative_id uuid, p_to_representative_id uuid,
  p_lines jsonb, p_reason text, p_approve boolean default true, p_entry_date date default null, p_reference text default null,
  p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_model text; a public.company_representatives%rowtype; b public.company_representatives%rowtype;
  v_group uuid := gen_random_uuid(); v_out uuid; v_in uuid; v_no text; v_total numeric; v_replay jsonb; v_date date; v_effect text;
  l public.rep_ledger_lines%rowtype;
begin
  v_model := public.rep_ledger_require(p_company, 'manage');
  v_replay := public.rep_ledger_replay(p_company, p_idempotency_key);
  if v_replay is not null then return v_replay; end if;
  a := public.rep_ledger_active_rep(p_company, p_from_representative_id);
  b := public.rep_ledger_active_rep(p_company, p_to_representative_id);
  if a.id = b.id then raise exception 'Choose two different representatives.' using errcode = '22023'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Give a reason for the transfer.' using errcode = '22023'; end if;
  v_date := public.rep_ledger_check_date(p_entry_date);
  v_no := public.rep_ledger_new_entry_no();
  insert into public.rep_ledger_entries (company_id, representative_id, entry_no, entry_type, status, entry_date, description, reference,
    reason, counterparty_representative_id, transfer_group, operating_model, idempotency_key, created_by, created_by_name)
  values (p_company, a.id, v_no, 'transfer_out', 'pending', v_date, 'Transferred to ' || b.full_name, nullif(btrim(p_reference), ''),
    btrim(p_reason), b.id, v_group, v_model, p_idempotency_key, auth.uid(), public.rep_ledger_actor_name(p_company))
  returning id into v_out;
  v_total := public.rep_ledger_insert_lines(p_company, v_out, p_lines);
  insert into public.rep_ledger_entries (company_id, representative_id, entry_no, entry_type, status, entry_date, description, reference,
    reason, counterparty_representative_id, transfer_group, operating_model, created_by, created_by_name)
  values (p_company, b.id, v_no || '-IN', 'transfer_in', 'pending', v_date, 'Transferred from ' || a.full_name, nullif(btrim(p_reference), ''),
    btrim(p_reason), a.id, v_group, v_model, auth.uid(), public.rep_ledger_actor_name(p_company))
  returning id into v_in;
  for l in select * from public.rep_ledger_lines where entry_id = v_out loop
    insert into public.rep_ledger_lines (entry_id, company_product_id, master_product_id, product_name, quantity, unit_value, line_value)
    values (v_in, l.company_product_id, l.master_product_id, l.product_name, l.quantity, l.unit_value, l.line_value);
  end loop;
  if coalesce(p_approve, true) then
    v_effect := public.rep_entry_apply_stock(v_out, 1);
    perform public.rep_ledger_finalise(v_out, 0, v_total, v_effect);
    perform public.rep_ledger_finalise(v_in, v_total, 0, v_effect);
  end if;
  perform public.rep_ledger_audit(p_company, 'rep_ledger.transfer', v_out,
    jsonb_build_object('entry_no', v_no, 'value', v_total, 'from', a.id, 'to', b.id, 'approved', coalesce(p_approve, true)));
  return jsonb_build_object('id', v_out, 'in_id', v_in, 'entry_no', v_no, 'status', case when coalesce(p_approve, true) then 'posted' else 'pending' end,
                            'value', v_total, 'balance', public.rep_balance(a.id), 'receiver_balance', public.rep_balance(b.id));
end $$;

-- Approve or reject a pending return or transfer. For a return, p_values [{line_id, unit_value}] sets the accepted
-- value of individual lines (lines not listed keep the value recorded).
create or replace function public.decide_rep_entry(p_entry_id uuid, p_decision text, p_note text default null, p_values jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e public.rep_ledger_entries%rowtype; v_in public.rep_ledger_entries%rowtype; v_val jsonb; v_total numeric; v_effect text; v_unit numeric;
begin
  select * into e from public.rep_ledger_entries where id = p_entry_id for update;
  if not found then raise exception 'Entry not found.' using errcode = 'P0002'; end if;
  perform public.rep_ledger_require(e.company_id, 'manage');
  if e.entry_type = 'transfer_in' then
    select * into e from public.rep_ledger_entries where transfer_group = e.transfer_group and entry_type = 'transfer_out' for update;
  end if;
  if e.status <> 'pending' then raise exception 'This entry is already %.', e.status using errcode = '22023'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Choose approve or reject.' using errcode = '22023'; end if;
  if e.operating_model is distinct from public.operating_company_model(e.company_id) then
    raise exception 'The company changed operating model after this was recorded. Reject it and record it again.' using errcode = '22023';
  end if;
  if e.entry_type = 'transfer_out' then
    select * into v_in from public.rep_ledger_entries where transfer_group = e.transfer_group and entry_type = 'transfer_in' for update;
  end if;

  perform set_config('carehub.rep_ledger_authority', 'on', true);
  if p_decision = 'reject' then
    update public.rep_ledger_entries set status = 'rejected', decided_by = auth.uid(), decided_by_name = public.rep_ledger_actor_name(e.company_id),
           decided_at = now(), decision_note = nullif(btrim(p_note), '')
     where id = e.id or (e.transfer_group is not null and transfer_group = e.transfer_group);
    perform set_config('carehub.rep_ledger_authority', '', true);
    perform public.rep_ledger_audit(e.company_id, 'rep_ledger.rejected', e.id, jsonb_build_object('entry_no', e.entry_no));
    return jsonb_build_object('id', e.id, 'entry_no', e.entry_no, 'status', 'rejected', 'balance', public.rep_balance(e.representative_id));
  end if;

  if e.entry_type = 'return' and p_values is not null and jsonb_typeof(p_values) = 'array' then
    for v_val in select * from jsonb_array_elements(p_values) loop
      begin v_unit := round((v_val ->> 'unit_value')::numeric, 2);
      exception when others then raise exception 'Accepted values must be numbers.' using errcode = '22023'; end;
      if v_unit is null or v_unit < 0 then raise exception 'Accepted values must be zero or more.' using errcode = '22023'; end if;
      update public.rep_ledger_lines set unit_value = v_unit, line_value = round(quantity * v_unit, 2)
       where id = (v_val ->> 'line_id')::uuid and entry_id = e.id;
    end loop;
  end if;
  update public.rep_ledger_entries set decided_by_name = public.rep_ledger_actor_name(e.company_id), decision_note = nullif(btrim(p_note), '')
   where id = e.id or (e.transfer_group is not null and transfer_group = e.transfer_group);
  perform set_config('carehub.rep_ledger_authority', '', true);

  select coalesce(sum(line_value), 0) into v_total from public.rep_ledger_lines where entry_id = e.id;
  v_effect := public.rep_entry_apply_stock(e.id, 1);
  if e.entry_type = 'return' then
    perform public.rep_ledger_finalise(e.id, 0, v_total, v_effect);
  else
    perform public.rep_ledger_finalise(e.id, 0, v_total, v_effect);
    perform public.rep_ledger_finalise(v_in.id, v_total, 0, v_effect);
  end if;
  perform public.rep_ledger_audit(e.company_id, 'rep_ledger.approved', e.id, jsonb_build_object('entry_no', e.entry_no, 'value', v_total));
  return jsonb_build_object('id', e.id, 'entry_no', e.entry_no, 'status', 'posted', 'value', v_total, 'balance', public.rep_balance(e.representative_id));
end $$;

create or replace function public.record_rep_adjustment(p_company uuid, p_representative_id uuid, p_direction text, p_amount numeric,
  p_reason text, p_reference text, p_entry_date date default null, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_model text; r public.company_representatives%rowtype; v_id uuid; v_no text; v_amount numeric := round(p_amount, 2); v_replay jsonb;
begin
  v_model := public.rep_ledger_require(p_company, 'manage');
  v_replay := public.rep_ledger_replay(p_company, p_idempotency_key);
  if v_replay is not null then return v_replay; end if;
  select * into r from public.company_representatives where id = p_representative_id and company_id = p_company;
  if not found then raise exception 'Representative not found.' using errcode = 'P0002'; end if;
  if p_direction not in ('debit', 'credit') then
    raise exception 'Choose whether the adjustment increases (debit) or reduces (credit) what the representative owes.' using errcode = '22023';
  end if;
  if v_amount is null or v_amount <= 0 then raise exception 'Enter an amount greater than zero.' using errcode = '22023'; end if;
  if nullif(btrim(p_reason), '') is null or nullif(btrim(p_reference), '') is null then
    raise exception 'An adjustment needs a reason and a reference.' using errcode = '22023';
  end if;
  v_no := public.rep_ledger_new_entry_no();
  insert into public.rep_ledger_entries (company_id, representative_id, entry_no, entry_type, status, entry_date, debit, credit, description,
    reference, reason, operating_model, idempotency_key, created_by, created_by_name, decided_by, decided_at)
  values (p_company, r.id, v_no, 'adjustment', 'posted', public.rep_ledger_check_date(p_entry_date),
    case when p_direction = 'debit' then v_amount else 0 end, case when p_direction = 'credit' then v_amount else 0 end,
    'Adjustment: ' || btrim(p_reason), btrim(p_reference), btrim(p_reason), v_model, p_idempotency_key,
    auth.uid(), public.rep_ledger_actor_name(p_company), auth.uid(), now())
  returning id into v_id;
  perform public.rep_ledger_audit(p_company, 'rep_ledger.adjustment', v_id,
    jsonb_build_object('entry_no', v_no, 'direction', p_direction, 'amount', v_amount, 'reason', btrim(p_reason)));
  return jsonb_build_object('id', v_id, 'entry_no', v_no, 'status', 'posted', 'value', v_amount, 'balance', public.rep_balance(r.id));
end $$;

-- The mirror of a posted entry (both halves of a transfer), with its stock effect undone.
create or replace function public.reverse_rep_entry(p_entry_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e public.rep_ledger_entries%rowtype; x public.rep_ledger_entries%rowtype; v_model text; v_id uuid; v_first uuid; v_no text; v_replay jsonb;
  l public.rep_ledger_lines%rowtype;
begin
  select * into e from public.rep_ledger_entries where id = p_entry_id for update;
  if not found then raise exception 'Entry not found.' using errcode = 'P0002'; end if;
  v_model := public.rep_ledger_require(e.company_id, 'manage');
  v_replay := public.rep_ledger_replay(e.company_id, p_idempotency_key);
  if v_replay is not null then return v_replay; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Give a reason for the reversal.' using errcode = '22023'; end if;
  if e.status <> 'posted' then raise exception 'Only a posted entry can be reversed.' using errcode = '22023'; end if;
  if e.entry_type = 'reversal' then raise exception 'A reversal cannot itself be reversed. Record an adjustment instead.' using errcode = '22023'; end if;
  if exists (select 1 from public.rep_ledger_entries where reverses_entry_id = e.id) then
    raise exception 'This entry has already been reversed.' using errcode = '22023';
  end if;
  if e.stock_effect <> 'none' and e.operating_model <> v_model then
    raise exception 'The company changed operating model after this entry, so its stock cannot be undone automatically. Record an adjustment instead.'
      using errcode = '22023';
  end if;
  v_no := public.rep_ledger_new_entry_no();
  for x in select * from public.rep_ledger_entries
            where id = e.id or (e.transfer_group is not null and transfer_group = e.transfer_group) order by entry_type desc loop
    insert into public.rep_ledger_entries (company_id, representative_id, entry_no, entry_type, status, entry_date, debit, credit,
      description, reference, reason, counterparty_representative_id, reverses_entry_id, operating_model, stock_effect, idempotency_key,
      created_by, created_by_name, decided_by, decided_at)
    values (x.company_id, x.representative_id, v_no || case when x.entry_type = 'transfer_in' then '-IN' else '' end, 'reversal', 'posted',
      public.rep_ledger_check_date(null), x.credit, x.debit, 'Reversal of ' || x.entry_no, x.entry_no, btrim(p_reason),
      x.counterparty_representative_id, x.id, v_model, x.stock_effect,
      case when v_first is null then p_idempotency_key end,
      auth.uid(), public.rep_ledger_actor_name(x.company_id), auth.uid(), now())
    returning id into v_id;
    v_first := coalesce(v_first, v_id);
    for l in select * from public.rep_ledger_lines where entry_id = x.id loop
      insert into public.rep_ledger_lines (entry_id, company_product_id, master_product_id, rep_product_id, product_name, quantity, unit_value, line_value)
      values (v_id, l.company_product_id, l.master_product_id, l.rep_product_id, l.product_name, l.quantity, l.unit_value, l.line_value);
    end loop;
    if x.entry_type in ('supply', 'return', 'transfer_out') and x.stock_effect <> 'none' then
      perform public.rep_entry_apply_stock(x.id, -1);
    end if;
  end loop;
  perform public.rep_ledger_audit(e.company_id, 'rep_ledger.reversed', e.id, jsonb_build_object('entry_no', e.entry_no, 'reversal_no', v_no, 'reason', btrim(p_reason)));
  return jsonb_build_object('id', v_first, 'entry_no', v_no, 'status', 'posted', 'balance', public.rep_balance(e.representative_id));
end $$;

-- ── 9. Statements ──────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.rep_statement(p_representative_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r public.company_representatives%rowtype; c public.businesses%rowtype; v_open numeric; v_close numeric; v_entries jsonb;
  v_totals jsonb; v_pending jsonb;
begin
  select * into r from public.company_representatives where id = p_representative_id;
  -- coalesce: for someone who is not a representative the comparison is NULL, and NOT NULL would let them through.
  if not found or not (public.rep_ledger_can(r.company_id, 'view') or coalesce(r.id = public.caller_representative_id(), false)) then
    raise exception 'Statement not found.' using errcode = 'P0002';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a period whose start is on or before its end.' using errcode = '22023';
  end if;
  select * into c from public.businesses where id = r.company_id;
  select coalesce(sum(debit - credit), 0) into v_open from public.rep_ledger_entries
   where representative_id = r.id and status = 'posted' and entry_date < p_from;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.entry_date, t.created_at, t.entry_no), '[]'::jsonb) into v_entries from (
    select e.id, e.entry_no, e.entry_type, e.entry_date, e.created_at, e.reference, e.description, e.reason, e.payment_method,
           e.payment_recipient, e.return_condition, e.debit, e.credit, e.created_by_name, e.decided_by_name, e.operating_model,
           v_open + sum(e.debit - e.credit) over (order by e.entry_date, e.created_at, e.entry_no) as running_balance,
           (select coalesce(jsonb_agg(jsonb_build_object('product_name', l.product_name, 'quantity', l.quantity, 'unit_value', l.unit_value,
                                                          'line_value', l.line_value) order by l.created_at, l.id), '[]'::jsonb)
              from public.rep_ledger_lines l where l.entry_id = e.id) as lines
      from public.rep_ledger_entries e
     where e.representative_id = r.id and e.status = 'posted' and e.entry_date between p_from and p_to) t;

  select jsonb_build_object(
    'supplies', coalesce(sum(debit) filter (where entry_type = 'supply'), 0),
    'payments', coalesce(sum(credit) filter (where entry_type = 'payment'), 0),
    'returns', coalesce(sum(credit) filter (where entry_type = 'return'), 0),
    'transfers_in', coalesce(sum(debit) filter (where entry_type = 'transfer_in'), 0),
    'transfers_out', coalesce(sum(credit) filter (where entry_type = 'transfer_out'), 0),
    'adjustments_debit', coalesce(sum(debit) filter (where entry_type in ('adjustment', 'reversal')), 0),
    'adjustments_credit', coalesce(sum(credit) filter (where entry_type in ('adjustment', 'reversal')), 0),
    'debits', coalesce(sum(debit), 0), 'credits', coalesce(sum(credit), 0))
    into v_totals
    from public.rep_ledger_entries where representative_id = r.id and status = 'posted' and entry_date between p_from and p_to;
  v_close := v_open + (v_totals ->> 'debits')::numeric - (v_totals ->> 'credits')::numeric;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'entry_no', entry_no, 'entry_type', entry_type, 'entry_date', entry_date,
                                               'description', description) order by entry_date, created_at), '[]'::jsonb)
    into v_pending from public.rep_ledger_entries where representative_id = r.id and status = 'pending';

  return jsonb_build_object(
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'address', c.address, 'city', c.city, 'state', c.state, 'phone', c.phone, 'email', c.email),
    'representative', jsonb_build_object('id', r.id, 'full_name', r.full_name, 'rep_code', r.rep_code, 'email', r.email, 'status', r.status),
    'operating_model', c.operating_model,
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'generated_at', now(), 'currency', 'NGN',
    'opening_balance', round(v_open, 2), 'closing_balance', round(v_close, 2),
    'position', case when v_close > 0 then 'owes' when v_close < 0 then 'credit' else 'settled' end,
    'totals', v_totals, 'entries', v_entries, 'pending', v_pending);
end $$;

-- Consolidated figures for every representative of the company; p_territory narrows it to one territory.
create or replace function public.rep_ledger_summary(p_company uuid, p_from date, p_to date, p_territory uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_rows jsonb;
begin
  perform public.rep_ledger_require(p_company, 'view');
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a period whose start is on or before its end.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.full_name), '[]'::jsonb) into v_rows from (
    select r.id, r.full_name, r.rep_code, r.status, r.rep_account_id, r.account_dormant_since, r.territory_id,
      (select tt.name from public.territories tt where tt.id = r.territory_id) as territory_name,
      round(coalesce(sum(e.debit - e.credit) filter (where e.entry_date < p_from), 0), 2) as opening_balance,
      round(coalesce(sum(e.debit) filter (where e.entry_type = 'supply' and e.entry_date between p_from and p_to), 0), 2) as supplies,
      round(coalesce(sum(e.credit) filter (where e.entry_type = 'payment' and e.entry_date between p_from and p_to), 0), 2) as payments,
      round(coalesce(sum(e.credit) filter (where e.entry_type = 'return' and e.entry_date between p_from and p_to), 0), 2) as returns,
      round(coalesce(sum(e.debit - e.credit) filter (where e.entry_type in ('transfer_in', 'transfer_out') and e.entry_date between p_from and p_to), 0), 2) as transfers_net,
      round(coalesce(sum(e.debit - e.credit) filter (where e.entry_type in ('adjustment', 'reversal') and e.entry_date between p_from and p_to), 0), 2) as adjustments_net,
      round(coalesce(sum(e.debit - e.credit) filter (where e.entry_date <= p_to), 0), 2) as closing_balance,
      (select count(*) from public.rep_ledger_entries p where p.representative_id = r.id and p.status = 'pending') as pending_count
    from public.company_representatives r
    left join public.rep_ledger_entries e on e.representative_id = r.id and e.status = 'posted'
   where r.company_id = p_company and (p_territory is null or r.territory_id = p_territory)
   group by r.id) t;
  return jsonb_build_object('company_id', p_company, 'period', jsonb_build_object('from', p_from, 'to', p_to), 'generated_at', now(),
    'currency', 'NGN', 'operating_model', public.operating_company_model(p_company), 'territory_id', p_territory,
    'territory_name', (select name from public.territories where id = p_territory), 'representatives', v_rows,
    'totals', (select jsonb_build_object(
      'opening_balance', coalesce(sum((x ->> 'opening_balance')::numeric), 0), 'supplies', coalesce(sum((x ->> 'supplies')::numeric), 0),
      'payments', coalesce(sum((x ->> 'payments')::numeric), 0), 'returns', coalesce(sum((x ->> 'returns')::numeric), 0),
      'transfers_net', coalesce(sum((x ->> 'transfers_net')::numeric), 0), 'adjustments_net', coalesce(sum((x ->> 'adjustments_net')::numeric), 0),
      'closing_balance', coalesce(sum((x ->> 'closing_balance')::numeric), 0)) from jsonb_array_elements(v_rows) x));
end $$;

-- The company's transaction register (spec 7 and 8): every entry in the period, in date order, filtered by
-- representative, transaction type ('transfer' means both halves), product and territory, with its full audit
-- trail: who recorded it, who approved or rejected it, what it reverses and what reversed it. Pending and rejected
-- entries are listed (with their status) but only posted ones count in the totals.
create or replace function public.rep_ledger_register(p_company uuid, p_from date, p_to date,
  p_representative_id uuid default null, p_entry_type text default null, p_product_id uuid default null,
  p_territory uuid default null, p_limit integer default 200, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_rows jsonb; v_totals jsonb; v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  perform public.rep_ledger_require(p_company, 'view');
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a period whose start is on or before its end.' using errcode = '22023';
  end if;
  if p_entry_type is not null and p_entry_type not in ('supply', 'payment', 'return', 'transfer', 'transfer_out', 'transfer_in', 'adjustment', 'reversal') then
    raise exception 'Unknown transaction type.' using errcode = '22023';
  end if;

  with m as (
    select e.*, r.full_name as representative_name, r.rep_code, r.territory_id as rep_territory_id
      from public.rep_ledger_entries e join public.company_representatives r on r.id = e.representative_id
     where e.company_id = p_company and e.entry_date between p_from and p_to
       and (p_representative_id is null or e.representative_id = p_representative_id)
       and (p_entry_type is null or e.entry_type = p_entry_type or (p_entry_type = 'transfer' and e.entry_type in ('transfer_out', 'transfer_in')))
       and (p_territory is null or r.territory_id = p_territory)
       and (p_product_id is null
            or exists (select 1 from public.rep_ledger_lines l where l.entry_id = e.id and l.company_product_id = p_product_id)
            -- a reversal carries no lines of its own: it matches through the entry it reverses
            or exists (select 1 from public.rep_ledger_lines l where l.entry_id = e.reverses_entry_id and l.company_product_id = p_product_id)))
  select
    (select jsonb_build_object('count', count(*), 'posted', count(*) filter (where status = 'posted'),
        'pending', count(*) filter (where status = 'pending'), 'rejected', count(*) filter (where status = 'rejected'),
        'debits', coalesce(sum(debit) filter (where status = 'posted'), 0),
        'credits', coalesce(sum(credit) filter (where status = 'posted'), 0)) from m),
    (select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.entry_date, t.created_at, t.entry_no), '[]'::jsonb) from (
      select m.id, m.entry_no, m.entry_type, m.status, m.entry_date, m.created_at, m.description, m.reference, m.reason, m.note,
             m.payment_method, m.payment_recipient, m.return_condition, m.debit, m.credit, m.operating_model, m.stock_effect,
             m.created_by_name, m.decided_by_name, m.decided_at, m.decision_note,
             m.representative_id, m.representative_name, m.rep_code,
             (select tt.name from public.territories tt where tt.id = m.rep_territory_id) as territory_name,
             (select c.full_name from public.company_representatives c where c.id = m.counterparty_representative_id) as counterparty_name,
             (select o.entry_no from public.rep_ledger_entries o where o.id = m.reverses_entry_id) as reverses_entry_no,
             (select x.entry_no from public.rep_ledger_entries x where x.reverses_entry_id = m.id) as reversed_by_entry_no,
             (select coalesce(jsonb_agg(jsonb_build_object('company_product_id', l.company_product_id, 'product_name', l.product_name,
                       'quantity', l.quantity, 'unit_value', l.unit_value, 'line_value', l.line_value) order by l.created_at, l.id), '[]'::jsonb)
                from public.rep_ledger_lines l where l.entry_id = m.id) as lines
        from m order by m.entry_date, m.created_at, m.entry_no
       limit v_limit offset greatest(coalesce(p_offset, 0), 0)) t)
    into v_totals, v_rows;

  return jsonb_build_object('company_id', p_company, 'period', jsonb_build_object('from', p_from, 'to', p_to), 'generated_at', now(),
    'currency', 'NGN', 'operating_model', public.operating_company_model(p_company),
    'filters', jsonb_build_object('representative_id', p_representative_id, 'entry_type', p_entry_type, 'product_id', p_product_id,
                                  'territory_id', p_territory,
                                  'representative_name', (select full_name from public.company_representatives where id = p_representative_id and company_id = p_company),
                                  'product_name', (select name from public.products where id = p_product_id and business_id = p_company),
                                  'territory_name', (select name from public.territories where id = p_territory and business_id = p_company)),
    'totals', v_totals, 'entries', v_rows,
    'has_more', (v_totals ->> 'count')::integer > greatest(coalesce(p_offset, 0), 0) + v_limit);
end $$;

-- The signed-in representative's own profile (navigation and the "My company account" page).
create or replace function public.my_representative()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', r.id, 'company_id', r.company_id, 'company_name', c.name, 'operating_model', c.operating_model,
                            'rep_account_id', r.rep_account_id, 'rep_code', r.rep_code, 'full_name', r.full_name,
                            'balance', public.rep_balance(r.id))
    from public.company_representatives r join public.businesses c on c.id = r.company_id
   where r.id = public.caller_representative_id()
$$;

-- The company's official catalogue for its own representatives: names and prices, never stock or cost.
create or replace function public.rep_company_catalog(p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_rep uuid := public.caller_representative_id(); v_company uuid; v_q text := nullif(btrim(coalesce(p_search, '')), ''); v_rows jsonb;
begin
  if v_rep is null then raise exception 'Only the company''s representatives can view its catalogue here.' using errcode = '42501'; end if;
  select company_id into v_company from public.company_representatives where id = v_rep;
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.name, t.id), '[]'::jsonb) into v_rows from (
    select p.id, p.name, p.generic_name, p.category, p.price, p.price_unit, p.sales_unit, p.rx_status, p.master_product_id
      from public.products p
     where p.business_id = v_company
       and (v_q is null or p.name ilike '%' || replace(replace(v_q, '%', '\%'), '_', '\_') || '%'
                        or p.generic_name ilike '%' || replace(replace(v_q, '%', '\%'), '_', '\_') || '%')
     order by p.name, p.id
     limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) t;
  return jsonb_build_object('company', (select jsonb_build_object('id', id, 'name', name, 'phone', phone, 'email', email, 'address', address)
                                          from public.businesses where id = v_company),
                            'products', v_rows);
end $$;

-- ── 10. Switching ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Everything a switch depends on, hashed: if any of it changes between the preview and the confirmation, the
-- switch is refused and the owner reviews a fresh summary.
create or replace function public.operating_model_state_token(p_company uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select md5(concat_ws('|',
    (select operating_model from public.businesses where id = p_company),
    (select string_agg(concat_ws(',', r.id, r.status, r.staff_id, r.rep_account_id, s.business_id, s.status), ';' order by r.id)
       from public.company_representatives r left join public.staff s on s.id = r.staff_id where r.company_id = p_company),
    (select string_agg(concat_ws(',', representative_id, company_product_id, quantity), ';' order by representative_id, company_product_id)
       from public.rep_custody where company_id = p_company and quantity > 0),
    (select string_agg(concat_ws(',', p.business_id, p.id, p.stock), ';' order by p.business_id, p.id)
       from public.products p join public.company_representatives r on r.rep_account_id = p.business_id
      where r.company_id = p_company and coalesce(p.stock, 0) > 0),
    (select count(*) || ':' || coalesce(max(created_at)::text, '') from public.rep_ledger_entries where company_id = p_company),
    (select count(*) from public.rep_ledger_entries where company_id = p_company and status = 'pending')))
$$;

-- The figures a switch must leave unchanged (spec 9.2), taken just before and just after it inside the same
-- transaction. Stock is counted across the company and every representative account it has ever had (dormant ones
-- included), by master catalogue item, so a unit that moves between them is the same unit; a product with no
-- master item is counted on its own. Value is at the company's cost price for that item. Custody is reported but not
-- compared: a switch converts custody into account stock and back by design.
create or replace function public.operating_model_reconciliation(p_company uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with accounts as (
    select p_company as id
    union select r.rep_account_id from public.company_representatives r where r.company_id = p_company and r.rep_account_id is not null),
  units as (
    select coalesce(p.master_product_id, p.id) as item, sum(coalesce(p.stock, 0))::bigint as qty
      from public.products p where p.business_id in (select id from accounts) group by 1),
  cost as (
    select distinct on (coalesce(p.master_product_id, p.id)) coalesce(p.master_product_id, p.id) as item, coalesce(p.cost_price, 0) as unit_cost
      from public.products p where p.business_id = p_company order by coalesce(p.master_product_id, p.id), coalesce(p.stock, 0) desc, p.id)
  select jsonb_build_object(
    'ledger_entries', (select count(*) from public.rep_ledger_entries where company_id = p_company),
    'pending_entries', (select count(*) from public.rep_ledger_entries where company_id = p_company and status = 'pending'),
    'total_balance', (select coalesce(sum(debit - credit), 0) from public.rep_ledger_entries where company_id = p_company and status = 'posted'),
    'balances', (select coalesce(jsonb_object_agg(r.id, public.rep_balance(r.id)), '{}'::jsonb)
                   from public.company_representatives r where r.company_id = p_company),
    'stock_units', (select coalesce(sum(qty), 0) from units),
    'stock_value', (select round(coalesce(sum(u.qty * c.unit_cost), 0), 2) from units u join cost c on c.item = u.item),
    'custody_units', (select coalesce(sum(quantity), 0) from public.rep_custody where company_id = p_company),
    'items', (select coalesce(jsonb_object_agg(item, qty), '{}'::jsonb) from units))
$$;

create or replace function public.operating_model_preview(p_company uuid, p_target text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_model text; v_reps jsonb := '[]'::jsonb; v_blockers jsonb := '[]'::jsonb; v_warnings jsonb := '[]'::jsonb;
  r record; v_stock jsonb; v_held integer; v_transit integer; v_pending integer; v_staff public.staff%rowtype;
  v_orders integer; v_credit_count integer; v_credit_total numeric;
begin
  if auth.uid() is null then raise exception 'Sign in to continue.' using errcode = '42501'; end if;
  v_model := public.operating_company_model(p_company);
  if not (public.is_platform_admin() or public.is_business_owner_email(auth.email(), p_company)) then
    raise exception 'Only the company owner can change the operating model.' using errcode = '42501';
  end if;
  if p_target not in ('centralised', 'decentralised') then
    raise exception 'Choose Centralised or Decentralised.' using errcode = '22023';
  end if;
  if p_target = v_model then
    raise exception 'The company already runs the % model.', v_model using errcode = '22023';
  end if;

  select count(*) into v_pending from public.rep_ledger_entries where company_id = p_company and status = 'pending';
  if v_pending > 0 then
    v_blockers := v_blockers || jsonb_build_object('code', 'pending_entries', 'count', v_pending,
      'message', v_pending || ' return(s) or transfer(s) are awaiting approval. Approve or reject them first.');
  end if;

  for r in select * from public.company_representatives where company_id = p_company order by full_name loop
    v_staff := null;
    select * into v_staff from public.staff where id = r.staff_id;
    if p_target = 'decentralised' then
      select coalesce(jsonb_agg(jsonb_build_object('company_product_id', k.company_product_id, 'product_name', k.product_name,
               'custody', k.quantity, 'company_stock', coalesce(p.stock, 0), 'carry', least(k.quantity, greatest(coalesce(p.stock, 0), 0)))
               order by k.product_name), '[]'::jsonb)
        into v_stock from public.rep_custody k left join public.products p on p.id = k.company_product_id
       where k.representative_id = r.id and k.quantity > 0;
      if r.status = 'active' and (v_staff.id is null or v_staff.status <> 'active') then
        v_blockers := v_blockers || jsonb_build_object('code', 'rep_without_login', 'representative_id', r.id,
          'message', r.full_name || ' has no active login. Wait for them to accept their invitation, or make them inactive.');
      end if;
      select count(*) into v_held from public.sales
       where business_id = p_company and cashier_staff_id = r.staff_id and is_on_hold
         and coalesce(status, '') not in ('resumed', 'converted', 'deleted') and deleted_at is null;
      if v_held > 0 then
        v_warnings := v_warnings || jsonb_build_object('code', 'held_sales_stay', 'representative_id', r.id,
          'message', r.full_name || ' has ' || v_held || ' held sale(s) on the company POS. They stay company sales.');
      end if;
      -- Field orders the rep raised on the company account are the company's orders: company staff finish them.
      select count(*) into v_orders from public.orders
       where business_id = p_company and created_by_staff_id = r.staff_id and status in ('submitted', 'approved', 'processing', 'dispatched');
      if v_orders > 0 then
        v_warnings := v_warnings || jsonb_build_object('code', 'open_orders_stay', 'representative_id', r.id, 'count', v_orders,
          'message', r.full_name || ' has ' || v_orders || ' open order(s) on the company account. They stay company orders; company staff approve, dispatch and deliver them.');
      end if;
    else
      select coalesce(jsonb_agg(jsonb_build_object('rep_product_id', p.id, 'product_name', p.name, 'stock', p.stock,
               'company_product_id', cp.id, 'returns_to_company', cp.id is not null) order by p.name), '[]'::jsonb)
        into v_stock
        from public.products p
        left join lateral (select c2.id from public.products c2 where c2.business_id = p_company and c2.master_product_id = p.master_product_id
                            and p.master_product_id is not null order by coalesce(c2.stock, 0) desc, c2.id limit 1) cp on true
       where p.business_id = r.rep_account_id and coalesce(p.stock, 0) > 0 and r.rep_account_id is not null;
      if exists (select 1 from jsonb_array_elements(v_stock) x where not (x ->> 'returns_to_company')::boolean) then
        v_warnings := v_warnings || jsonb_build_object('code', 'unlinked_stock', 'representative_id', r.id,
          'message', r.full_name || ' holds products the company does not carry. They stay in ' || r.full_name || '''s archived account.');
      end if;
      select count(*) into v_held from public.sales
       where business_id = r.rep_account_id and is_on_hold and coalesce(status, '') not in ('resumed', 'converted', 'deleted') and deleted_at is null;
      if v_held > 0 then
        v_blockers := v_blockers || jsonb_build_object('code', 'held_sales', 'representative_id', r.id,
          'message', r.full_name || ' has ' || v_held || ' held sale(s) in their own account. Complete or delete them first.');
      end if;
      select count(*) into v_transit from public.stock_transfers
       where status = 'in_transit' and (from_branch_id = r.rep_account_id or to_branch_id = r.rep_account_id);
      if v_transit > 0 then
        v_blockers := v_blockers || jsonb_build_object('code', 'transfers_in_transit', 'representative_id', r.id,
          'message', r.full_name || ' has ' || v_transit || ' stock transfer(s) in transit. Receive or cancel them first.');
      end if;
      -- Open orders in the rep's own account: a rep loses access to the account, so they must be finished first
      -- (otherwise nobody who knows them could deliver them, and they would be raised a second time centrally).
      select count(*) into v_orders from public.orders
       where business_id = r.rep_account_id and status in ('submitted', 'approved', 'processing', 'dispatched');
      if v_orders > 0 then
        v_blockers := v_blockers || jsonb_build_object('code', 'open_orders', 'representative_id', r.id, 'count', v_orders,
          'message', r.full_name || ' has ' || v_orders || ' open order(s) in their own account. Deliver, reject or cancel them first.');
      end if;
      -- Customers who owe the rep for credit sales: the sales stay in the archived account, where the company owner
      -- can still collect them (Locations); nothing is moved or written off.
      select count(*), coalesce(sum(balance), 0) into v_credit_count, v_credit_total from public.sales
       where business_id = r.rep_account_id and coalesce(is_credit, false) and coalesce(balance, 0) > 0 and deleted_at is null
         and coalesce(status, '') not in ('deleted', 'refunded');
      if v_credit_count > 0 then
        v_warnings := v_warnings || jsonb_build_object('code', 'customer_credit_in_account', 'representative_id', r.id,
          'count', v_credit_count, 'amount', round(v_credit_total, 2),
          'message', r.full_name || '''s customers owe ₦' || to_char(round(v_credit_total, 2), 'FM999,999,999,990.00') || ' on '
            || v_credit_count || ' credit sale(s). They stay in ' || r.full_name || '''s archived account, where the owner can still collect them.');
      end if;
    end if;
    v_reps := v_reps || jsonb_build_object('id', r.id, 'full_name', r.full_name, 'rep_code', r.rep_code, 'status', r.status,
      'has_login', v_staff.id is not null and v_staff.status = 'active', 'rep_account_id', r.rep_account_id,
      'reuses_account', r.rep_account_id is not null, 'balance', public.rep_balance(r.id),
      'converts', case when p_target = 'centralised' then r.rep_account_id is not null or (v_staff.id is not null and v_staff.business_id <> p_company)
                       else r.status = 'active' and v_staff.id is not null and v_staff.status = 'active' end,
      'stock', v_stock);
  end loop;

  return jsonb_build_object('company_id', p_company, 'from', v_model, 'to', p_target,
    'token', public.operating_model_state_token(p_company), 'representatives', v_reps,
    'blockers', v_blockers, 'warnings', v_warnings,
    'total_balance', (select coalesce(sum(debit - credit), 0) from public.rep_ledger_entries where company_id = p_company and status = 'posted'),
    'changes', case when p_target = 'decentralised' then jsonb_build_array(
        'Each active representative gets their own account with their own POS, stock, selling prices, sales and records.',
        'Representatives stop selling through the company account; only company staff do.',
        'Goods in each representative''s custody move from the company''s stock to their account (you can change the quantities).',
        'Balances and ledger history carry over unchanged.')
      else jsonb_build_array(
        'Representatives return to the company account as staff and sell through the company POS and stock.',
        'Stock in their accounts that the company carries moves back into the company''s stock and is recorded as in their custody.',
        'Their own accounts are kept, read-only in practice, with all sales and records.',
        'Balances and ledger history carry over unchanged.') end);
end $$;

-- p_stock_plan (to Decentralised only): [{representative_id, company_product_id, qty}] overrides how much custody
-- moves into each account; anything not listed moves its full custody, capped at the company's stock.
-- One transaction: any failure leaves the company exactly as it was (no partial conversion).
create or replace function public.switch_operating_model(p_company uuid, p_target text, p_token text,
  p_stock_plan jsonb default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_preview jsonb; v_from text; r public.company_representatives%rowtype; k public.rep_custody%rowtype; p public.products%rowtype;
  v_account uuid; v_rep_prod uuid; v_qty integer; v_plan jsonb; v_cp uuid; v_moved jsonb := '[]'::jsonb; v_exceptions jsonb := '[]'::jsonb;
  v_change uuid := gen_random_uuid(); v_converted integer := 0; v_stock integer; v_found boolean; v_result jsonb;
  v_before jsonb; v_after jsonb; v_mismatch text;
begin
  perform 1 from public.businesses where id = p_company for update;
  v_preview := public.operating_model_preview(p_company, p_target);
  v_from := v_preview ->> 'from';
  if p_token is null or p_token <> v_preview ->> 'token' then
    raise exception 'Something changed since you reviewed the summary. Review it again before confirming.' using errcode = '40001';
  end if;
  if jsonb_array_length(v_preview -> 'blockers') > 0 then
    raise exception 'Resolve the items listed before switching: %', (v_preview -> 'blockers' -> 0 ->> 'message') using errcode = '22023';
  end if;
  v_before := public.operating_model_reconciliation(p_company);

  if p_target = 'decentralised' then
    -- Active representatives get (or get back) their own account; inactive ones stay company-side.
    for r in select * from public.company_representatives where company_id = p_company and status = 'active' order by full_name loop
      v_account := public.rep_move_to_account(r.id);
      v_converted := v_converted + 1;
      for k in select * from public.rep_custody where representative_id = r.id and quantity > 0 order by product_name loop
        v_plan := null;
        if p_stock_plan is not null and jsonb_typeof(p_stock_plan) = 'array' then
          select x into v_plan from jsonb_array_elements(p_stock_plan) x
           where (x ->> 'representative_id')::uuid = r.id and (x ->> 'company_product_id')::uuid = k.company_product_id limit 1;
        end if;
        v_qty := coalesce((v_plan ->> 'qty')::integer, k.quantity);
        if v_qty < 0 or v_qty > k.quantity then
          raise exception 'The quantity for % (%) must be between 0 and %.', k.product_name, r.full_name, k.quantity using errcode = '22023';
        end if;
        select * into p from public.products where id = k.company_product_id and business_id = p_company for update;
        v_found := found;
        v_stock := case when v_found then greatest(coalesce(p.stock, 0), 0) else 0 end;
        if v_found and (p.master_product_id is null or p.tracking_mode <> 'none') then
          v_exceptions := v_exceptions || jsonb_build_object('representative_id', r.id, 'product', k.product_name,
            'message', k.product_name || ' is not linked to the master catalogue or is batch-tracked, so it stays in company stock.');
          v_stock := 0;
        end if;
        if v_qty > v_stock then
          v_exceptions := v_exceptions || jsonb_build_object('representative_id', r.id, 'product', k.product_name,
            'message', 'Moved ' || v_stock || ' of ' || v_qty || ' ' || k.product_name || ' (what the company could move).');
          v_qty := v_stock;
        end if;
        if v_qty > 0 then
          v_rep_prod := public.rep_account_product(v_account, p.id);
          perform public.apply_stock_change(p_company, p.id, -v_qty, 'transfer', null, 'operating_model_switch', v_change::text, k.id::text,
            'To ' || r.full_name || '''s own account (model change)', 'model:' || v_change || ':' || k.id || ':company', null);
          perform public.apply_stock_change(v_account, v_rep_prod, v_qty, 'transfer', null, 'operating_model_switch', v_change::text, k.id::text,
            'From the company (model change)', 'model:' || v_change || ':' || k.id || ':rep', null);
        end if;
        v_moved := v_moved || jsonb_build_object('representative_id', r.id, 'product', k.product_name, 'custody', k.quantity, 'moved', v_qty);
        update public.rep_custody set quantity = 0, updated_at = now() where id = k.id;
      end loop;
    end loop;
  else
    -- Every representative working in their own account comes back, whatever their status.
    for r in select * from public.company_representatives where company_id = p_company order by full_name loop
      if r.rep_account_id is not null then
        for p in select * from public.products where business_id = r.rep_account_id and coalesce(stock, 0) > 0 order by name for update loop
          v_cp := null;
          select c2.id into v_cp from public.products c2
           where c2.business_id = p_company and c2.master_product_id = p.master_product_id and p.master_product_id is not null
           order by coalesce(c2.stock, 0) desc, c2.id limit 1;
          if v_cp is null or p.tracking_mode <> 'none' then
            v_exceptions := v_exceptions || jsonb_build_object('representative_id', r.id, 'product', p.name,
              'message', p.stock || ' of ' || p.name || ' stay in ' || r.full_name || '''s archived account ('
                || case when v_cp is null then 'not a company product' else 'batch-tracked' end || ').');
            continue;
          end if;
          perform public.apply_stock_change(r.rep_account_id, p.id, -p.stock, 'transfer', null, 'operating_model_switch', v_change::text, p.id::text,
            'To the company (model change)', 'model:' || v_change || ':' || p.id || ':rep', null);
          perform public.apply_stock_change(p_company, v_cp, p.stock, 'transfer', null, 'operating_model_switch', v_change::text, p.id::text,
            'From ' || r.full_name || '''s account (model change)', 'model:' || v_change || ':' || p.id || ':company', null);
          perform public.rep_custody_add(p_company, r.id, v_cp, p.name, p.stock);
          v_moved := v_moved || jsonb_build_object('representative_id', r.id, 'product', p.name, 'moved', p.stock);
        end loop;
      end if;
      if r.rep_account_id is not null or exists (select 1 from public.staff s where s.id = r.staff_id and s.business_id <> p_company) then
        perform public.rep_move_to_company(r.id);
        v_converted := v_converted + 1;
      end if;
    end loop;
  end if;

  update public.businesses set operating_model = p_target, operating_model_changed_at = now() where id = p_company;

  -- Validation (spec 9.4): nothing may be gained or lost. Any difference raises, which rolls the whole switch back, so
  -- the company is never left half converted.
  v_after := public.operating_model_reconciliation(p_company);
  v_mismatch := case
    when v_after -> 'ledger_entries' <> v_before -> 'ledger_entries' then 'ledger entries'
    when v_after -> 'pending_entries' <> v_before -> 'pending_entries' then 'pending entries'
    when v_after -> 'balances' <> v_before -> 'balances' then 'representative balances'
    when v_after -> 'items' <> v_before -> 'items' then 'stock quantities'
    when v_after -> 'stock_value' <> v_before -> 'stock_value' then 'stock value'
  end;
  if v_mismatch is not null then
    raise exception 'The switch was cancelled and nothing changed: % did not reconcile after the move. Please contact CareHub support.', v_mismatch
      using errcode = 'P0001';
  end if;

  v_result := jsonb_build_object('change_id', v_change, 'from', v_from, 'to', p_target, 'converted', v_converted,
                                 'stock', v_moved, 'exceptions', v_exceptions, 'effective_at', now(),
                                 'reconciliation', jsonb_build_object('balanced', true,
                                   'before', v_before - 'items' - 'balances', 'after', v_after - 'items' - 'balances',
                                   'items_checked', (select count(*) from jsonb_object_keys(v_after -> 'items'))));
  insert into public.operating_model_changes (id, company_id, from_model, to_model, initiated_by, initiated_by_name, summary, result, exceptions, note)
  values (v_change, p_company, v_from, p_target, auth.uid(), public.rep_ledger_actor_name(p_company), v_preview, v_result, v_exceptions,
          nullif(btrim(p_note), ''));
  perform public.rep_ledger_audit(p_company, 'operating_model.switched', v_change,
    jsonb_build_object('from', v_from, 'to', p_target, 'converted', v_converted, 'exceptions', jsonb_array_length(v_exceptions)));
  insert into public.staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
  values (p_company, null, true, 'operating_model_changed', 'Operating model changed to ' || initcap(p_target),
          v_converted || ' representative(s) moved to the new structure. Balances and history are unchanged.', '/dashboard/settings');
  -- Company staff who manage or view representative accounts (not the representatives themselves, notified above).
  insert into public.staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
  select p_company, s.id, false, 'operating_model_changed', 'Operating model changed to ' || initcap(p_target),
         v_converted || ' representative(s) moved to the new structure. Balances and history are unchanged.', '/dashboard/representatives'
    from public.staff s join public.roles ro on ro.business_id = s.business_id and ro.name = s.role
   where s.business_id = p_company and s.status = 'active'
     and ((ro.permissions ->> 'canManageRepLedger') = 'true' or (ro.permissions ->> 'canViewRepLedger') = 'true')
     and not exists (select 1 from public.company_representatives cr where cr.staff_id = s.id);
  return v_result;
end $$;

-- Registration: the model the owner chose on the form. Service role only (/api/register-business).
create or replace function public.set_registration_operating_model(p_email text, p_model text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if p_model not in ('centralised', 'decentralised') then
    raise exception 'Choose Centralised or Decentralised.' using errcode = '22023';
  end if;
  select id into v_id from public.businesses
   where lower(email) = lower(btrim(p_email)) and parent_business_id is null and business_type = 'manufacturer_importer' and status = 'pending'
     and not exists (select 1 from public.operating_model_changes m where m.company_id = businesses.id);
  if v_id is null then return false; end if;
  update public.businesses set operating_model = p_model, operating_model_changed_at = now() where id = v_id;
  insert into public.operating_model_changes (company_id, from_model, to_model, initiated_by_name, note)
  values (v_id, null, p_model, 'Registration', 'Chosen at registration');
  return true;
end $$;

-- ── 11. Representative accounts are not locations ──────────────────────────────────────────────────────────────────
-- Spec 5.5: the operating model must not take away an existing capability. Counting representative accounts as
-- locations would let a switch to Decentralised use up the plan's branch allowance and stop the company adding
-- branches. Both functions below are their live definitions (read 2026-11-04) with one change each: the location
-- tree skips account_kind = 'rep_account' rows (a rep account has no children, so nothing below it is skipped).

create or replace function public.guard_business_insert()
returns trigger language plpgsql set search_path to 'public' as $function$
declare
  v_parent_status text;
  v_parent_plan   text;
  v_parent_expiry timestamptz;
  v_parent_found  boolean := false;
  v_root          uuid;
  v_locations     integer;
  v_limit         integer;
begin
  -- Server endpoints, migrations, SECURITY DEFINER RPCs (current_user is the
  -- owner there) and platform admins are trusted.
  if current_user in ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin')
     or coalesce(public.is_platform_admin(), false) then
    return new;
  end if;

  if coalesce(new.is_platform_admin, false) then
    raise exception 'Only a platform administrator can create a business with platform-admin access.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.referring_agent_id is not null then
    raise exception 'referring_agent_id cannot be supplied; it is derived from referral_code_used.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.parent_business_id is null then
    -- Root business: never by direct insert. Registration goes through the
    -- SECURITY DEFINER RPCs (exempt above); no client code inserts a root row.
    raise exception 'Businesses are created through registration, not by direct insert.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Branch: the caller must own an active parent (read under the caller's RLS).
  select true, b.status, b.plan, b.plan_expires_at
    into v_parent_found, v_parent_status, v_parent_plan, v_parent_expiry
    from public.businesses b
   where b.id = new.parent_business_id
     and lower(b.email) = lower(auth.email());

  if not coalesce(v_parent_found, false) then
    raise exception 'A branch can only be added to a business you own (parent_business_id).'
      using errcode = 'insufficient_privilege';
  end if;
  if v_parent_status is distinct from 'active' then
    raise exception 'A branch can only be added to an active business (parent_business_id).'
      using errcode = 'insufficient_privilege';
  end if;
  if new.status is null or new.status not in ('active', 'pending') then
    raise exception 'A new branch must have status active or pending; only a platform administrator can set another status.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.plan is not null and new.plan is distinct from v_parent_plan then
    raise exception 'A new branch must be on its parent business''s plan; only a platform administrator can set another plan.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Plan (carehub_20261214): no new branch once the plan is restricted, and no more locations (the main business plus
  -- every branch below it) than the plan allows.
  if public.plan_state(v_parent_expiry) = 'restricted' then
    raise exception 'Your CareHub plan has expired. Renew it in Settings to add branches.' using errcode = '23514';
  end if;
  v_limit := public.plan_limit(v_parent_plan, 'locations');
  if v_limit is not null then
    with recursive up(id, parent_business_id, depth) as (
      select b.id, b.parent_business_id, 0 from public.businesses b where b.id = new.parent_business_id
      union all
      select p.id, p.parent_business_id, up.depth + 1 from public.businesses p join up on p.id = up.parent_business_id where up.depth < 10
    )
    select id into v_root from up where parent_business_id is null limit 1;
    with recursive tree(id, depth) as (
      select v_root, 0
      union all
      select c.id, t.depth + 1 from public.businesses c join tree t on c.parent_business_id = t.id
       where t.depth < 10 and c.deleted_at is null and c.account_kind = 'business'  -- carehub_20270102: rep accounts are not locations
    )
    select count(*) into v_locations from tree;
    if v_locations >= v_limit then
      raise exception 'Your plan allows up to % locations. Upgrade your plan in Settings to add more.', v_limit using errcode = '23514';
    end if;
  end if;

  -- The expiry is never the caller's (nor the column default's): a branch
  -- inherits its parent's.
  new.plan_expires_at := v_parent_expiry;

  return new;
end
$function$;

create or replace function public.business_billing_overview(p_business_id uuid)
returns json language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_root uuid;
  v_out json;
begin
  if p_business_id is null or not (public.is_business_owner(p_business_id) or public.is_platform_admin()) then
    return null;
  end if;

  with recursive up(id, parent_business_id, depth) as (
    select b.id, b.parent_business_id, 0 from public.businesses b where b.id = p_business_id
    union all
    select p.id, p.parent_business_id, up.depth + 1 from public.businesses p join up on p.id = up.parent_business_id where up.depth < 10
  )
  select id into v_root from up where parent_business_id is null limit 1;
  v_root := coalesce(v_root, p_business_id);

  with recursive tree(id, depth) as (
    select v_root, 0
    union all
    select c.id, t.depth + 1 from public.businesses c join tree t on c.parent_business_id = t.id
     where t.depth < 10 and c.deleted_at is null and c.account_kind = 'business'  -- carehub_20270102: rep accounts are not locations
  )
  select json_build_object(
    'business', json_build_object('id', b.id, 'name', b.name, 'email', b.email, 'phone', b.phone,
                                  'address', b.address, 'city', b.city, 'state', b.state, 'logo_url', b.logo_url),
    'plan', coalesce(b.plan, 'basic'),
    'expires_at', b.plan_expires_at,
    'grace_ends_at', public.plan_grace_ends_at(b.plan_expires_at),
    'state', public.plan_state(b.plan_expires_at),
    'limits', json_build_object(
      'staff', public.plan_limit(b.plan, 'staff'),
      'locations', public.plan_limit(b.plan, 'locations'),
      'products', public.plan_limit(b.plan, 'products')),
    'usage', json_build_object(
      'staff', (select count(*) from public.staff s where s.business_id = p_business_id),
      'locations', (select count(*) from tree),
      'products', (select count(*) from public.products pr where pr.business_id = p_business_id)),
    'payments', coalesce((
      select json_agg(json_build_object(
               'id', pp.id, 'receipt_number', pp.receipt_number, 'reference', pp.reference, 'plan', pp.plan,
               'months', pp.months, 'amount', pp.naira_amount, 'currency', pp.currency,
               'payment_method', pp.payment_method, 'provider_transaction_id', pp.provider_transaction_id,
               'period_start', pp.period_start, 'period_end', pp.period_end, 'paid_at', pp.paid_at,
               'is_first_payment', pp.is_first_payment)
             order by pp.paid_at desc)
        from public.plan_payments pp
       where pp.business_id = v_root and pp.status = 'success'), '[]'::json),
    'attempts', coalesce((
      select json_agg(a order by a.created_at desc) from (
        select i.reference, i.status, i.purpose, i.provider, i.expected_amount / 100 as amount, i.currency,
               (i.metadata ->> 'months')::int as months, i.metadata ->> 'plan' as plan,
               i.metadata ->> 'refund_reason' as refund_reason, i.created_at, i.updated_at
          from public.payment_intents i
         where i.business_id = v_root
           and i.purpose in ('plan_renewal', 'plan_renewal_wallet')
           and i.status <> 'settled'
           and not exists (select 1 from public.plan_payments pp where pp.reference = i.reference)
           and i.created_at > now() - interval '180 days'
         order by i.created_at desc
         limit 50) a), '[]'::json)
  ) into v_out
  from public.businesses b
  where b.id = v_root;

  return v_out;
end;
$$;
-- Grants on business_billing_overview are unchanged by create or replace (authenticated may execute; it checks the
-- caller itself). guard_business_insert is a trigger function and keeps its trigger.

-- ── 12. Grants ─────────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'businesses_operating_model_guard()', 'is_rep_account(uuid)', 'products_rep_account_not_public()',
    'ecommerce_products_rep_account_refused()', 'rep_ledger_entries_append_only()', 'rep_ledger_lines_append_only()', 'operating_model_changes_append_only()',
    'rep_ledger_can(uuid, text)', 'caller_representative_id()', 'rep_ledger_actor_name(uuid)', 'operating_company_model(uuid)',
    'rep_ledger_require(uuid, text)', 'rep_balance(uuid)', 'rep_ledger_audit(uuid, text, uuid, jsonb)', 'rep_account_open(uuid)',
    'rep_move_to_account(uuid)', 'rep_move_to_company(uuid)', 'add_company_representative(uuid, uuid)',
    'set_representative_status(uuid, text)', 'rep_account_product(uuid, uuid)', 'rep_custody_add(uuid, uuid, uuid, text, integer)',
    'rep_entry_apply_stock(uuid, integer)', 'rep_ledger_new_entry_no()', 'rep_ledger_check_date(date)', 'rep_ledger_active_rep(uuid, uuid)',
    'rep_ledger_insert_lines(uuid, uuid, jsonb)', 'rep_ledger_replay(uuid, text)', 'rep_ledger_finalise(uuid, numeric, numeric, text)',
    'record_rep_supply(uuid, uuid, jsonb, date, text, text, text)',
    'record_rep_payment(uuid, uuid, numeric, text, text, date, text, text, text)',
    'record_rep_return(uuid, uuid, jsonb, text, boolean, date, text, text, text)',
    'record_rep_transfer(uuid, uuid, uuid, jsonb, text, boolean, date, text, text)',
    'decide_rep_entry(uuid, text, text, jsonb)', 'record_rep_adjustment(uuid, uuid, text, numeric, text, text, date, text)',
    'reverse_rep_entry(uuid, text, text)', 'rep_statement(uuid, date, date)', 'rep_ledger_summary(uuid, date, date, uuid)',
    'rep_ledger_register(uuid, date, date, uuid, text, uuid, uuid, integer, integer)', 'set_representative_territory(uuid, uuid)',
    'operating_model_reconciliation(uuid)', 'my_representative()', 'rep_company_catalog(text, integer, integer)', 'operating_model_state_token(uuid)',
    'operating_model_preview(uuid, text)', 'switch_operating_model(uuid, text, text, jsonb, text)',
    'set_registration_operating_model(text, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- What the app calls. Each checks the caller itself.
  foreach f in array array[
    'add_company_representative(uuid, uuid)', 'set_representative_status(uuid, text)',
    'record_rep_supply(uuid, uuid, jsonb, date, text, text, text)',
    'record_rep_payment(uuid, uuid, numeric, text, text, date, text, text, text)',
    'record_rep_return(uuid, uuid, jsonb, text, boolean, date, text, text, text)',
    'record_rep_transfer(uuid, uuid, uuid, jsonb, text, boolean, date, text, text)',
    'decide_rep_entry(uuid, text, text, jsonb)', 'record_rep_adjustment(uuid, uuid, text, numeric, text, text, date, text)',
    'reverse_rep_entry(uuid, text, text)', 'rep_statement(uuid, date, date)', 'rep_ledger_summary(uuid, date, date, uuid)',
    'rep_ledger_register(uuid, date, date, uuid, text, uuid, uuid, integer, integer)', 'set_representative_territory(uuid, uuid)',
    'my_representative()', 'rep_company_catalog(text, integer, integer)', 'operating_model_preview(uuid, text)',
    'switch_operating_model(uuid, text, text, jsonb, text)',
    -- used inside RLS policies, which run as the caller
    'rep_ledger_can(uuid, text)', 'caller_representative_id()', 'is_rep_account(uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
