import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../config/supabaseClient.js', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok-test' } } })) } },
}))

import WithdrawalOtpField from './WithdrawalOtpField.jsx'
import { supabase } from '../../config/supabaseClient.js'

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body })
const otpCalls = () => fetch.mock.calls.filter(([u]) => String(u).includes('/withdrawal-pin/otp'))

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
  it('starts with only a send button; the code is not requested until the user asks', async () => {
    render(<WithdrawalOtpField value="" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /email me a 6-digit code/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/email verification code/i)).toBeNull()
    // The mount only resumes a draft (GET); the code request (POST otp) waits for the user.
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/withdrawal-pin/draft', expect.anything()))
    expect(otpCalls()).toHaveLength(0)
  })

  it('requests a withdrawal code with the session token, then reveals the input', async () => {
    render(<WithdrawalOtpField value="" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    await waitFor(() => expect(screen.getByLabelText(/email verification code/i)).toBeInTheDocument())
    const [url, init] = otpCalls()[0]
    expect(url).toBe('/api/withdrawal-pin/otp')
    expect(init.headers.Authorization).toBe('Bearer tok-test')
    expect(JSON.parse(init.body)).toEqual({ purpose: 'withdrawal' })
    expect(screen.getByRole('status')).toHaveTextContent(/code sent/i)
  })

  it('sends amount + destination with the code request so the server owns the draft', async () => {
    render(<WithdrawalOtpField value="" onChange={() => {}} amount={10} bankCode="058" accountNumber="0123456789" />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    await waitFor(() => expect(screen.getByLabelText(/email verification code/i)).toBeInTheDocument())
    const [, init] = otpCalls()[0]
    expect(JSON.parse(init.body)).toEqual({ purpose: 'withdrawal', amount: 10, bankCode: '058', accountNumber: '0123456789' })
  })

  it('keeps only digits (max 6) and hands them to the parent', async () => {
    const seen = []
    render(<WithdrawalOtpField value="" onChange={(v) => seen.push(v)} />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    const input = await screen.findByLabelText(/email verification code/i)
    fireEvent.change(input, { target: { value: '12ab34567' } })
    expect(seen.at(-1)).toBe('123456')
  })

  it('pasting `123 456` lands whole as `123456` (strip-then-truncate)', async () => {
    const seen = []
    render(<WithdrawalOtpField value="" onChange={(v) => seen.push(v)} />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    const input = await screen.findByLabelText(/email verification code/i)
    fireEvent.paste(input, { clipboardData: { getData: () => '123 456' } })
    expect(seen.at(-1)).toBe('123456')
  })

  it('shows `Resend available in Ns` while inside the 60 s cooldown', async () => {
    render(<WithdrawalOtpField value="" onChange={() => {}} />)
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
    render(<WithdrawalOtpField value="" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    await waitFor(() => expect(screen.getByLabelText(/email verification code/i)).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/already on its way/)
  })

  it('resumes a live draft after reload: sent state, empty code, countdown + re-press terms', async () => {
    const issued = Date.now() - 61_000
    const expires = Date.now() + 9 * 60_000
    sessionStorage.setItem('cf-withdrawal-otp-meta', JSON.stringify({ draftId: 'd-1', otpIssuedAt: issued, draftExpiresAt: expires }))
    fetch.mockImplementation(async (url) => {
      if (String(url).includes('/withdrawal-pin/draft')) {
        return reply(200, { draft: { id: 'd-1', app: 'carefind', amount: 10, unit: 'coins', destination_mask: '••••6789', draft_expires_at: new Date(expires).toISOString(), otp_issued_at: new Date(issued).toISOString() } })
      }
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
    render(<WithdrawalOtpField value="" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too many codes/i))
    expect(screen.queryByLabelText(/email verification code/i)).toBeNull()
  })

  it('a network failure is an alert, and the button is usable again', async () => {
    fetch.mockImplementation(async (url) => {
      if (String(url).includes('/withdrawal-pin/draft')) return reply(200, { draft: null })
      throw new Error('offline')
    })
    render(<WithdrawalOtpField value="" onChange={() => {}} />)
    const btn = screen.getByRole('button', { name: /email me a 6-digit code/i })
    fireEvent.click(btn)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/network error/i))
    expect(btn).toBeEnabled()
  })

})
