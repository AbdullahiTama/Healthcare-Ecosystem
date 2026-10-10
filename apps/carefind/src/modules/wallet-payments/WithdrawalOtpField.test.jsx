import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../config/supabaseClient.js', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok-test' } } })) } },
}))

import WithdrawalOtpField from './WithdrawalOtpField.jsx'
import { supabase } from '../../config/supabaseClient.js'

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  vi.clearAllMocks()
  supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok-test' } } })
  globalThis.fetch = vi.fn()
})

describe('WithdrawalOtpField', () => {
  it('starts with only a send button; nothing is requested until the user asks', () => {
    render(<WithdrawalOtpField value="" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /email me a 6-digit code/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/email verification code/i)).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('requests a withdrawal code with the session token, then reveals the input', async () => {
    fetch.mockResolvedValue(reply(200, { ok: true }))
    render(<WithdrawalOtpField value="" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    await waitFor(() => expect(screen.getByLabelText(/email verification code/i)).toBeInTheDocument())
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/withdrawal-pin/otp')
    expect(init.headers.Authorization).toBe('Bearer tok-test')
    expect(JSON.parse(init.body)).toEqual({ purpose: 'withdrawal' })
    expect(screen.getByRole('status')).toHaveTextContent(/code sent/i)
  })

  it('keeps only digits (max 6) and hands them to the parent', async () => {
    fetch.mockResolvedValue(reply(200, { ok: true }))
    const seen = []
    render(<WithdrawalOtpField value="" onChange={(v) => seen.push(v)} />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    const input = await screen.findByLabelText(/email verification code/i)
    fireEvent.change(input, { target: { value: '12ab34567' } })
    expect(seen.at(-1)).toBe('123456')
  })

  it('surfaces the server rate limit (3 codes/hour) as an alert and never reveals a code', async () => {
    fetch.mockResolvedValue(reply(429, { error: 'Too many codes requested. Try again later.' }))
    render(<WithdrawalOtpField value="" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /email me a 6-digit code/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too many codes/i))
    expect(screen.queryByLabelText(/email verification code/i)).toBeNull()
  })

  it('a network failure is an alert, and the button is usable again', async () => {
    fetch.mockRejectedValue(new Error('offline'))
    render(<WithdrawalOtpField value="" onChange={() => {}} />)
    const btn = screen.getByRole('button', { name: /email me a 6-digit code/i })
    fireEvent.click(btn)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/network error/i))
    expect(btn).toBeEnabled()
  })

})
