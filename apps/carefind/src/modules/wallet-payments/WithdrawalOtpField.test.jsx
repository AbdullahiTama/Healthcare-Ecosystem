import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../config/supabaseClient.js', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok-test' } } })) } },
}))

import WithdrawalOtpField from './WithdrawalOtpField.jsx'
import { supabase } from '../../config/supabaseClient.js'

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body })
const otpCalls = () => fetch.mock.calls.filter(([u]) => String(u).includes('/withdrawal-pin/otp'))
const META_KEY = 'cf-withdrawal-otp-meta'

// A server draft as /api/withdrawal-pin/draft now returns it: amount + destinationKind so the form can be rebuilt, and
// otpExpiresAt (the CODE's expiry, capped by the draft's) so the countdown cannot promise more than the code lives.
const liveDraft = (overrides = {}) => ({
  id: 'd-1', app: 'carefind', amount: 10, unit: 'coins',
  destination_kind: 'saved', destinationKind: 'saved', savedAccountId: 'acc-1',
  destination_mask: '••••6789',
  otp_issued_at: new Date(Date.now() - 61_000).toISOString(),
  otpExpiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
  draft_expires_at: new Date(Date.now() + 9 * 60_000).toISOString(),
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok-test' } } })
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).includes('/withdrawal-pin/draft')) return reply(200, { draft: null })
    if (String(url).includes('/withdrawal-pin/otp')) return reply(200, { ok: true, expiresInSeconds: 300 })
    return reply(404, {})
  })
})

describe('WithdrawalOtpField', () => {
  it('shows a hint until the amount + destination arrive; the mount only resumes a draft (POST)', async () => {
    render(<WithdrawalOtpField value="" onChange={() => {}} />)
    expect(screen.getByText(/choose an amount and destination first/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /email me a 6-digit code/i })).toBeNull()
    expect(screen.queryByLabelText(/email verification code/i)).toBeNull()
    // The mount only resumes a draft (POST); the code request (POST otp) waits for the user.
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/withdrawal-pin/draft', expect.objectContaining({ method: 'POST' })))
    const [, draftInit] = fetch.mock.calls.find(([u]) => String(u).includes('/withdrawal-pin/draft'))
    expect(draftInit.headers.Authorization).toBe('Bearer tok-test')
    expect(JSON.parse(draftInit.body)).toEqual({})
    expect(otpCalls()).toHaveLength(0)
  })

  it('requests a withdrawal code with the session token, then reveals the input', async () => {
    render(<WithdrawalOtpField value="" onChange={() => {}} amount={10} bankCode="058" accountNumber="0123456789" />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    await waitFor(() => expect(screen.getByLabelText(/email verification code/i)).toBeInTheDocument())
    const [url, init] = otpCalls()[0]
    expect(url).toBe('/api/withdrawal-pin/otp')
    expect(init.headers.Authorization).toBe('Bearer tok-test')
    expect(JSON.parse(init.body)).toEqual({ purpose: 'withdrawal', amount: 10, bankCode: '058', accountNumber: '0123456789' })
    expect(screen.getByRole('status')).toHaveTextContent(/code sent/i)
  })

  it('sends a saved payout account instead of typed bank fields when one is chosen', async () => {
    render(<WithdrawalOtpField value="" onChange={() => {}} amount={10} payoutAccountId="acc-1" />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    await waitFor(() => expect(screen.getByLabelText(/email verification code/i)).toBeInTheDocument())
    const [, init] = otpCalls()[0]
    expect(JSON.parse(init.body)).toEqual({ purpose: 'withdrawal', amount: 10, payoutAccountId: 'acc-1' })
  })

  it('keeps only digits (max 6) and hands them to the parent', async () => {
    const seen = []
    render(<WithdrawalOtpField value="" onChange={(v) => seen.push(v)} amount={10} bankCode="058" accountNumber="0123456789" />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    const input = await screen.findByLabelText(/email verification code/i)
    fireEvent.change(input, { target: { value: '12ab34567' } })
    expect(seen.at(-1)).toBe('123456')
  })

  it('pasting `123 456` lands whole as `123456` (strip-then-truncate)', async () => {
    const seen = []
    render(<WithdrawalOtpField value="" onChange={(v) => seen.push(v)} amount={10} bankCode="058" accountNumber="0123456789" />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    const input = await screen.findByLabelText(/email verification code/i)
    fireEvent.paste(input, { clipboardData: { getData: () => '123 456' } })
    expect(seen.at(-1)).toBe('123456')
  })

  it('shows `Resend available in Ns` while inside the 60 s cooldown', async () => {
    render(<WithdrawalOtpField value="" onChange={() => {}} amount={10} bankCode="058" accountNumber="0123456789" />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    await screen.findByLabelText(/email verification code/i)
    expect(screen.getByRole('button', { name: /resend available in \d+s/i })).toBeDisabled()
  })

  it('a live draft (409 draft_active) keeps the sent state and shows the server text', async () => {
    fetch.mockImplementation(async (url) => {
      if (String(url).includes('/withdrawal-pin/draft')) return reply(200, { draft: null })
      if (String(url).includes('/withdrawal-pin/otp')) return reply(409, { error: 'A code is already on its way — check your email.', code: 'draft_active' })
      return reply(404, {})
    })
    render(<WithdrawalOtpField value="" onChange={() => {}} amount={10} bankCode="058" accountNumber="0123456789" />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    await waitFor(() => expect(screen.getByLabelText(/email verification code/i)).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/already on its way/)
  })

  it('resumes a live draft after reload: sent state, empty code, countdown + re-press terms', async () => {
    const issued = Date.now() - 61_000
    sessionStorage.setItem(META_KEY, JSON.stringify({ draftId: 'd-1', otpIssuedAt: issued, otpExpiresAt: Date.now() + 4 * 60_000 }))
    fetch.mockImplementation(async (url) => {
      if (String(url).includes('/withdrawal-pin/draft')) return reply(200, { draft: liveDraft() })
      return reply(404, {})
    })
    render(<WithdrawalOtpField value="" onChange={() => {}} />)
    const input = await screen.findByLabelText(/email verification code/i)
    expect(input.value).toBe('')
    expect(screen.getByRole('status')).toHaveTextContent(/Code sent · expires in \d+:\d\d · resend in \d+ s/)
    // Cooldown already elapsed: explicit re-press with the voids-prior warning.
    expect(screen.getByRole('button', { name: /send a new code/i })).toBeInTheDocument()
    expect(screen.getByText(/voids the previous one/i)).toBeInTheDocument()
  })

  it('surfaces the server rate limit (3 codes/hour) as an alert and never reveals a code', async () => {
    fetch.mockImplementation(async (url) => {
      if (String(url).includes('/withdrawal-pin/draft')) return reply(200, { draft: null })
      return reply(429, { error: 'Too many codes requested. Try again later.' })
    })
    render(<WithdrawalOtpField value="" onChange={() => {}} amount={10} bankCode="058" accountNumber="0123456789" />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too many codes/i))
    expect(screen.queryByLabelText(/email verification code/i)).toBeNull()
  })

  it('a network failure is an alert, and the button is usable again', async () => {
    fetch.mockImplementation(async (url) => {
      if (String(url).includes('/withdrawal-pin/draft')) return reply(200, { draft: null })
      throw new Error('offline')
    })
    render(<WithdrawalOtpField value="" onChange={() => {}} amount={10} bankCode="058" accountNumber="0123456789" />)
    const btn = screen.getByRole('button', { name: /email me a 6-digit code/i })
    fireEvent.click(btn)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/network error/i))
    expect(btn).toBeEnabled()
  })

  it('"Send a new code" re-presses with reissue:true so the server voids the prior code', async () => {
    const issued = Date.now() - 61_000
    sessionStorage.setItem(META_KEY, JSON.stringify({ draftId: 'd-1', otpIssuedAt: issued, otpExpiresAt: Date.now() + 4 * 60_000 }))
    fetch.mockImplementation(async (url) => {
      if (String(url).includes('/withdrawal-pin/draft')) return reply(200, { draft: liveDraft() })
      if (String(url).includes('/withdrawal-pin/otp')) return reply(200, { ok: true, expiresInSeconds: 300 })
      return reply(404, {})
    })
    render(<WithdrawalOtpField value="" onChange={() => {}} amount={10} bankCode="058" accountNumber="0123456789" />)
    fireEvent.click(await screen.findByRole('button', { name: /send a new code/i }))
    await waitFor(() => expect(otpCalls()).toHaveLength(1))
    const [, init] = otpCalls()[0]
    expect(JSON.parse(init.body)).toMatchObject({ purpose: 'withdrawal', amount: 10, reissue: true })
  })

  it('editing the amount after a code was sent resets to un-sent (fresh request required)', async () => {
    const seen = []
    const props = { value: '', onChange: (v) => seen.push(v), amount: 10, bankCode: '058', accountNumber: '0123456789' }
    const { rerender } = render(<WithdrawalOtpField {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    await screen.findByLabelText(/email verification code/i)
    rerender(<WithdrawalOtpField {...props} amount={20} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /email me a 6-digit code/i })).toBeInTheDocument())
    expect(screen.queryByLabelText(/email verification code/i)).toBeNull()
    expect(seen.at(-1)).toBe('')
  })

  // ── The reported defect: "a correct code is rejected, across attempts, including a newly issued one" ──
  describe('a resumed session survives the form being rebuilt', () => {
    it('does NOT discard the live code when the wallet restores the amount after a reload', async () => {
      // Before the fix, the first keystroke in the rebuilt form changed the request key and wiped the resumed session,
      // so the code already sitting in the user's inbox became un-submittable.
      fetch.mockImplementation(async (url) => {
        if (String(url).includes('/withdrawal-pin/draft')) return reply(200, { draft: liveDraft() })
        return reply(404, {})
      })
      const seen = []
      const onResume = vi.fn()
      const { rerender } = render(<WithdrawalOtpField value="" onChange={(v) => seen.push(v)} onResume={onResume} />)
      await screen.findByLabelText(/email verification code/i)

      // The wallet receives the draft and rebuilds the form from it.
      await waitFor(() => expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ amount: 10, savedAccountId: 'acc-1' })))
      rerender(<WithdrawalOtpField value="" onChange={(v) => seen.push(v)} onResume={onResume} amount="10" payoutAccountId="acc-1" />)

      // Still armed, no extra code requested, nothing typed into the box by the component itself.
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/code sent/i))
      expect(screen.getByLabelText(/email verification code/i)).toBeInTheDocument()
      expect(otpCalls()).toHaveLength(0)
      expect(seen).toHaveLength(0)
    })

    it('keeps the code when the amount arrives in stages rather than all at once', async () => {
      fetch.mockImplementation(async (url) => {
        if (String(url).includes('/withdrawal-pin/draft')) return reply(200, { draft: liveDraft() })
        return reply(404, {})
      })
      const { rerender } = render(<WithdrawalOtpField value="" onChange={() => {}} />)
      await screen.findByLabelText(/email verification code/i)
      rerender(<WithdrawalOtpField value="" onChange={() => {}} amount="1" />)
      rerender(<WithdrawalOtpField value="" onChange={() => {}} amount="10" />)
      rerender(<WithdrawalOtpField value="" onChange={() => {}} amount="10" payoutAccountId="acc-1" />)
      await waitFor(() => expect(screen.getByLabelText(/email verification code/i)).toBeInTheDocument())
      expect(otpCalls()).toHaveLength(0)
    })

    it('still resets on a REAL edit once the rebuilt form matches the code', async () => {
      // The protection is not permanent: after the form matches, changing the amount is a genuine change and must ask
      // for a fresh code, exactly as before.
      fetch.mockImplementation(async (url) => {
        if (String(url).includes('/withdrawal-pin/draft')) return reply(200, { draft: liveDraft() })
        return reply(404, {})
      })
      const seen = []
      const onResume = vi.fn()
      const props = { value: '', onChange: (v) => seen.push(v), onResume }
      const { rerender } = render(<WithdrawalOtpField {...props} />)
      await screen.findByLabelText(/email verification code/i)
      await waitFor(() => expect(onResume).toHaveBeenCalled())

      rerender(<WithdrawalOtpField {...props} amount="10" payoutAccountId="acc-1" />)
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/code sent/i))

      rerender(<WithdrawalOtpField {...props} amount="25" payoutAccountId="acc-1" />)
      await waitFor(() => expect(screen.getByRole('button', { name: /email me a 6-digit code/i })).toBeInTheDocument())
      expect(seen.at(-1)).toBe('')
    })

    it('a 409 draft_active paints the resend cooldown instead of offering to void the code in the inbox', async () => {
      // The reported loop: the 409 branch knew no issue time, so the cooldown read 0 and "Send a new code" was live at
      // once. One tap issued a new code and made the one already read by the user unusable.
      fetch.mockImplementation(async (url) => {
        if (String(url).includes('/withdrawal-pin/draft')) return reply(200, { draft: null })
        if (String(url).includes('/withdrawal-pin/otp')) {
          return reply(409, {
            error: 'A code is already on its way — check your email.', code: 'draft_active',
            draftId: 'd-9', otpIssuedAt: Date.now() - 5_000, expiresInSeconds: 295,
            amount: 10, unit: 'coins', destinationKind: 'saved', savedAccountId: 'acc-1', destinationMask: '••••6789',
          })
        }
        return reply(404, {})
      })
      const onResume = vi.fn()
      render(<WithdrawalOtpField value="" onChange={() => {}} onResume={onResume} amount={10} payoutAccountId="acc-1" />)
      fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
      await screen.findByLabelText(/email verification code/i)
      await waitFor(() => expect(screen.getByRole('button', { name: /resend available in \d+s/i })).toBeDisabled())
      expect(screen.queryByRole('button', { name: /send a new code/i })).toBeNull()
      // The live draft is adopted so the wallet can rebuild the form to match the code already sent.
      await waitFor(() => expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ amount: 10, savedAccountId: 'acc-1' })))
    })

    it('counts the countdown down to when the CODE expires, never the 10-minute draft', async () => {
      // The draft lives 10 minutes and the code 5. Painting the draft's expiry promised up to five extra minutes and
      // then failed the user with "that code has expired".
      fetch.mockImplementation(async (url) => {
        if (String(url).includes('/withdrawal-pin/draft')) {
          return reply(200, { draft: liveDraft({ otpExpiresAt: new Date(Date.now() + 90_000).toISOString() }) })
        }
        return reply(404, {})
      })
      render(<WithdrawalOtpField value="" onChange={() => {}} />)
      await screen.findByLabelText(/email verification code/i)
      await waitFor(() => {
        const text = screen.getByRole('status').textContent
        const m = text.match(/expires in (\d+):(\d\d)/)
        expect(m).not.toBeNull()
        const seconds = Number(m[1]) * 60 + Number(m[2])
        expect(seconds).toBeLessThanOrEqual(90)
        expect(seconds).toBeGreaterThan(60)
      })
    })

    it('falls back to the draft issue time when the server omits otpExpiresAt (older deployment)', async () => {
      fetch.mockImplementation(async (url) => {
        if (String(url).includes('/withdrawal-pin/draft')) {
          const d = liveDraft()
          delete d.otpExpiresAt
          return reply(200, { draft: d })
        }
        return reply(404, {})
      })
      render(<WithdrawalOtpField value="" onChange={() => {}} />)
      await screen.findByLabelText(/email verification code/i)
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/expires in \d+:\d\d/))
    })
  })

  describe('clipboard paste (the autofill that works for EMAIL-delivered codes)', () => {
    it('pastes a six-digit code the user chose to share', async () => {
      const seen = []
      globalThis.navigator.clipboard = { readText: vi.fn(async () => '123 456') }
      render(<WithdrawalOtpField value="" onChange={(v) => seen.push(v)} amount={10} bankCode="058" accountNumber="0123456789" />)
      fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
      await screen.findByLabelText(/email verification code/i)
      fireEvent.click(screen.getByRole('button', { name: /paste code from clipboard/i }))
      await waitFor(() => expect(seen.at(-1)).toBe('123456'))
    })

    it('explains itself instead of pasting when the clipboard holds no code', async () => {
      globalThis.navigator.clipboard = { readText: vi.fn(async () => 'Order 1234567890 shipped') }
      render(<WithdrawalOtpField value="" onChange={() => {}} amount={10} bankCode="058" accountNumber="0123456789" />)
      fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
      await screen.findByLabelText(/email verification code/i)
      fireEvent.click(screen.getByRole('button', { name: /paste code from clipboard/i }))
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no 6-digit code/i))
    })

    it('never claims autofill is guaranteed for an emailed code', async () => {
      render(<WithdrawalOtpField value="" onChange={() => {}} amount={10} bankCode="058" accountNumber="0123456789" />)
      fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
      expect(await screen.findByText(/may offer the code automatically/i)).toBeInTheDocument()
    })
  })

  it('keeps autofill hints honest and asks for a numeric keyboard without truncating a grouped paste', async () => {
    render(<WithdrawalOtpField value="" onChange={() => {}} amount={10} bankCode="058" accountNumber="0123456789" />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    const input = await screen.findByLabelText(/email verification code/i)
    expect(input).toHaveAttribute('autocomplete', 'one-time-code')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('enterkeyhint', 'done')
    // maxLength would truncate `123 456` to five digits before our own clean-up ever ran.
    expect(input).not.toHaveAttribute('maxlength')
    // The countdown is announced, so a screen reader reads the remaining life of the code.
    expect(input.getAttribute('aria-describedby')).toBe('otp-withdrawal-status')
    expect(document.getElementById('otp-withdrawal-status')).toHaveAttribute('role', 'status')
  })

  it('never writes the code or any PIN to browser storage', async () => {
    globalThis.navigator.clipboard = { readText: vi.fn(async () => '123456') }
    render(<WithdrawalOtpField value="123456" onChange={() => {}} amount={10} bankCode="058" accountNumber="0123456789" />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    await screen.findByLabelText(/email verification code/i)
    fireEvent.click(screen.getByRole('button', { name: /paste code from clipboard/i }))
    await waitFor(() => expect(sessionStorage.getItem(META_KEY)).toContain('otpIssuedAt'))
    const stored = sessionStorage.getItem(META_KEY)
    expect(stored).not.toContain('123456')
    expect(stored).not.toContain('0123456789')
    expect(Object.keys(JSON.parse(stored))).toEqual(['draftId', 'otpIssuedAt', 'otpExpiresAt'])
  })
})