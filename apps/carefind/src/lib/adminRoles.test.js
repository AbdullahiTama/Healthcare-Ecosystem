import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Spec: spec-carefindhub-sql-foundation.md
// This test verifies the SQL foundation migration meets the acceptance criteria
// without requiring a live DB: it inspects the migration file content for the
// required structures, and also validates JS-facing contracts.

const MIGRATION_PATH = resolve(process.cwd(), 'sql/20260906_carefindhub_foundation.sql')
const SUPABASE_JS_PATH = resolve(process.cwd(), '../carehub/src/services/supabase.js')

function migration() {
  return readFileSync(MIGRATION_PATH, 'utf8')
}

describe('CareFindHub SQL foundation migration file', () => {
  it('exists at apps/carefind/sql/20260906_carefindhub_foundation.sql', () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true)
  })

  it('resolves Team naming via information_schema check before creating admin_team_members (no duplicate)', () => {
    const sql = migration()
    // must check platform_team_members existence
    expect(sql).toMatch(/information_schema\.tables.*platform_team_members/)
    // must rename if platform exists, else create admin_team_members
    expect(sql).toMatch(/alter table public\.platform_team_members rename to admin_team_members/i)
    expect(sql).toMatch(/create table if not exists public\.admin_team_members/i)
    // must not create second table unconditionally — the DO block handles single table
    expect(sql).toMatch(/not creating duplicate/)
  })

  it('ensures businesses has required columns and status check', () => {
    const sql = migration()
    expect(sql).toMatch(/alter table public\.businesses add column if not exists owner_name/i)
    expect(sql).toMatch(/alter table public\.businesses add column if not exists owner_email/i)
    expect(sql).toMatch(/alter table public\.businesses add column if not exists category/i)
    expect(sql).toMatch(/alter table public\.businesses add column if not exists ecommerce_enabled/i)
    expect(sql).toMatch(/alter table public\.businesses add column if not exists deleted_at/i)
    // status check pending/active/suspended/revoked
    expect(sql).toMatch(/businesses_status_check/)
    expect(sql).toMatch(/pending.*active.*suspended.*revoked/s)
    // indexes
    expect(sql).toMatch(/businesses_status_idx/)
    expect(sql).toMatch(/businesses_ecommerce_enabled_idx/)
  })

  it('creates agent_tiers with community_coordinator max_children 20', () => {
    const sql = migration()
    expect(sql).toMatch(/create table if not exists public\.agent_tiers/i)
    expect(sql).toMatch(/agent.*community_coordinator.*state_coordinator/s)
    expect(sql).toMatch(/max_children/)
    // seeded 20 for community_coordinator
    expect(sql).toMatch(/community_coordinator.*20/s)
    expect(sql).toMatch(/max_children\s*=\s*20/)
  })

  it('augments agents with full_name,email unique,password_hash,referral_code CF-,tier,parent_agent_id,state,commission_pct,status', () => {
    const sql = migration()
    expect(sql).toMatch(/alter table public\.agents add column if not exists full_name/i)
    expect(sql).toMatch(/alter table public\.agents add column if not exists email/i)
    expect(sql).toMatch(/alter table public\.agents add column if not exists password_hash/i)
    expect(sql).toMatch(/alter table public\.agents add column if not exists tier/i)
    expect(sql).toMatch(/alter table public\.agents add column if not exists parent_agent_id/i)
    expect(sql).toMatch(/alter table public\.agents add column if not exists state/i)
    expect(sql).toMatch(/alter table public\.agents add column if not exists commission_pct/i)
    // referral_code generation CF-
    expect(sql).toMatch(/CF-/)
    expect(sql).toMatch(/generate_agent_referral_code/)
    expect(sql).toMatch(/referral_code.*unique/i)
  })

  it('creates agent_referrals, agent_earnings (amount_owed/paid, period), agent_transfers audit', () => {
    const sql = migration()
    expect(sql).toMatch(/create table if not exists public\.agent_referrals/i)
    expect(sql).toMatch(/create table if not exists public\.agent_earnings/i)
    expect(sql).toMatch(/amount_owed/)
    expect(sql).toMatch(/amount_paid/)
    expect(sql).toMatch(/payout_period/)
    expect(sql).toMatch(/create table if not exists public\.agent_transfers/i)
    // agent_transfers columns from spec design notes
    expect(sql).toMatch(/from_agent_id/)
    expect(sql).toMatch(/to_agent_id/)
    expect(sql).toMatch(/by_admin_id/)
  })

  it('creates admin_roles with permissions jsonb', () => {
    const sql = migration()
    expect(sql).toMatch(/create table if not exists public\.admin_roles/i)
    expect(sql).toMatch(/permissions jsonb/i)
  })

  it('creates admin_team_members (single team table) and applications, payout_requests', () => {
    const sql = migration()
    expect(sql).toMatch(/create table if not exists public\.admin_team_members/i)
    expect(sql).toMatch(/create table if not exists public\.applications/i)
    expect(sql).toMatch(/applicant_ref/)
    expect(sql).toMatch(/reviewed_by/)
    expect(sql).toMatch(/create table if not exists public\.payout_requests/i)
    expect(sql).toMatch(/requester_type/)
    expect(sql).toMatch(/amount/)
  })

  it('enables RLS and creates Allow all where appropriate, lockdown agents', () => {
    const sql = migration()
    expect(sql).toMatch(/enable row level security/i)
    // Allow all on non-sensitive
    expect(sql).toMatch(/create policy "Allow all" on public\.admin_roles/i)
    expect(sql).toMatch(/create policy "Allow all" on public\.agent_tiers/i)
    expect(sql).toMatch(/create policy "Allow all" on public\.agent_referrals/i)
    // agents must NOT have Allow all — lockdown via self-service
    // the file should explicitly drop Allow all if exists on agents
    expect(sql).toMatch(/drop policy "Allow all" on public\.agents/i)
    expect(sql).toMatch(/agents own row/)
    expect(sql).toMatch(/is_platform_admin\(\)/)
  })

  it('adds atomic SECURITY DEFINER earnings function with idempotency (payment_reference unique)', () => {
    const sql = migration()
    expect(sql).toMatch(/create or replace function public\.calculate_agent_earnings/i)
    expect(sql).toMatch(/security definer/i)
    expect(sql).toMatch(/payment_reference/)
    expect(sql).toMatch(/on conflict.*where payment_reference is not null.*do nothing/s)
    // second signature for spec compatibility
    expect(sql).toMatch(/calculate_agent_earnings\(.*business_id uuid.*plan_value numeric\)/s)
  })

  it('enforces 20-cap via trigger counting agents where parent_agent_id=X', () => {
    const sql = migration()
    expect(sql).toMatch(/enforce_agent_tier_limit/)
    expect(sql).toMatch(/max_children/)
    expect(sql).toMatch(/parent_agent_id/)
    expect(sql).toMatch(/count\(\*\).*parent_agent_id/)
    expect(sql).toMatch(/raise exception.*max children/)
    // errcode 42501 for server-side rejection per spec
    expect(sql).toMatch(/42501/)
  })

  it('uses IF NOT EXISTS everywhere and checks information_schema for idempotency', () => {
    const sql = migration()
    expect(sql).toMatch(/if not exists/i)
    expect(sql).toMatch(/information_schema/)
  })
})

describe('BUSINESS_PUBLIC_COLUMNS includes foundation columns', () => {
  it('exposes owner_name, owner_email, category, ecommerce_enabled for Dashboard/Businesses', () => {
    const js = readFileSync(SUPABASE_JS_PATH, 'utf8')
    // extract the constant
    const match = js.match(/const BUSINESS_PUBLIC_COLUMNS\s*=\s*'([^']+)'/)
    expect(match).not.toBeNull()
    const cols = match[1].split(',').map(s => s.trim())
    expect(cols).toContain('owner_name')
    expect(cols).toContain('owner_email')
    expect(cols).toContain('category')
    expect(cols).toContain('ecommerce_enabled')
    expect(cols).toContain('deleted_at')
    // must still contain core fields
    expect(cols).toContain('name')
    expect(cols).toContain('state')
    expect(cols).toContain('plan')
    expect(cols).toContain('status')
  })
})

describe('agents referral_code contract', () => {
  it('referral_code is unique CF- pattern', () => {
    const sql = migration()
    // unique index on referral_code is implied by table definition
    expect(sql).toMatch(/referral_code.*unique/i)
    // generation produces CF-
    expect(sql).toMatch(/'CF-'\s*\|\|/)
  })
})
