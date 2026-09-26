import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// The live `profiles` table, exactly as PostgREST reports it. Refresh with:
//   curl "$SUPABASE_URL/rest/v1/profiles?select=*&limit=1" -H "apikey: $ANON_KEY"
// A select list naming any column outside this set is rejected by Postgres with
// 42703 "column profiles.<name> does not exist" and HTTP 400, which fails the
// whole query rather than degrading it -- so the list is the contract, not a hint.
const PROFILES_COLUMNS = [
  'avatar_url',
  'bio',
  'country',
  'cover_url',
  'created_at',
  'display_name',
  'full_name',
  'id',
  'is_admin',
  'is_verified',
  'latitude',
  'location',
  'longitude',
  'news_last_seen',
  'paystack_subaccount_code',
  'phone',
  'show_followers',
  'specialty',
  'subscription_price',
  'verification_label',
  'website',
]

const h = vi.hoisted(() => ({
  requested: [],
  row: null,
}))

// A PostgREST-faithful double: `select` resolves the column list against the
// schema and fails the way PostgREST does when a column is unknown. A permissive
// mock would let an invalid select list pass unnoticed, which is how the missing
// `profiles.email` column reached production.
vi.mock('../config/supabaseClient', () => ({
  supabase: {
    from: vi.fn((table) => {
      if (table !== 'profiles') throw new Error(`unexpected table ${table}`)
      const chain = {
        select: (columns) => {
          h.requested.push(columns)
          const unknown = columns
            .split(',')
            .map((c) => c.trim())
            .filter((c) => c && !PROFILES_COLUMNS.includes(c))
          return {
            eq: () => ({
              maybeSingle: async () => {
                if (unknown.length) {
                  return {
                    data: null,
                    error: {
                      code: '42703',
                      message: `column profiles.${unknown[0]} does not exist`,
                    },
                  }
                }
                // Project the row down to the requested columns, the way
                // PostgREST does, so a column that is merely absent from a
                // fixture cannot masquerade as one that was withheld.
                if (!h.row) return { data: null, error: null }
                const out = {}
                for (const c of columns.split(',').map((c) => c.trim()).filter(Boolean)) {
                  out[c] = h.row[c] ?? null
                }
                return { data: out, error: null }
              },
            }),
          }
        },
      }
      return chain
    }),
  },
}))

import { useProfile } from './queries'

// The underlying row still carries `phone`. Public reads must not surface it.
const PROFILE_ROW = {
  id: 'u1',
  full_name: 'Maryam Abdulazeez',
  display_name: 'abeedarh',
  is_verified: true,
  verification_label: 'Verified pharmacist',
  location: 'Lagos, Nigeria',
  website: null,
  avatar_url: null,
  cover_url: null,
  subscription_price: 0,
  bio: null,
  show_followers: true,
  phone: '07000000000',
  specialty: 'Verified pharmacist',
  country: null,
}

function renderUseProfile(userId) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  return renderHook(() => useProfile(userId), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}

describe('useProfile', () => {
  beforeEach(() => {
    h.requested = []
    h.row = PROFILE_ROW
  })

  it('resolves the profile instead of failing on an unknown column', async () => {
    const { result } = renderUseProfile('u1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.error).toBeNull()
    expect(result.current.data.id).toBe('u1')
  })

  it('requests only columns that exist on the live profiles table', () => {
    renderUseProfile('u1')

    expect(h.requested).toHaveLength(1)
    const unknown = h.requested[0]
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c && !PROFILES_COLUMNS.includes(c))

    // Regression guard: `email` was requested here and does not exist, so every
    // profile view 400'd. Public profiles must never request a contact address.
    expect(unknown).toEqual([])
  })

  it('never requests profiles.phone, which is contact PII', () => {
    renderUseProfile('u1')

    // The public directory is readable by design (RLS policy "Anyone can read
    // profiles"), which made every column public. Ten real phone numbers were
    // retrievable with the publishable anon key. The column stays on the table
    // for the signed-in user's own completeness gate and the admin screen, both
    // of which read it as `authenticated`; it just must not be selected here.
    const requested = h.requested[0].split(',').map((c) => c.trim())
    expect(requested).not.toContain('phone')
  })

  it('returns a profile without any contact fields', async () => {
    const { result } = renderUseProfile('u1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).not.toHaveProperty('phone')
    expect(result.current.data).not.toHaveProperty('email')
    expect(result.current.data.display_name).toBe('abeedarh')
  })
})
