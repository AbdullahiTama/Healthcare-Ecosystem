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
                return { data: h.row, error: null }
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

const PROFILE_ROW = {
  id: 'u1',
  full_name: 'Ada Lovelace',
  display_name: 'ada',
  is_verified: true,
  verification_label: 'Verified Doctor',
  location: 'Lagos',
  website: null,
  avatar_url: null,
  cover_url: null,
  subscription_price: 1000,
  bio: 'Cardiologist',
  show_followers: true,
  phone: '08000000000',
  specialty: 'Cardiology',
  country: 'NG',
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
    expect(result.current.data).toEqual(PROFILE_ROW)
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
})
