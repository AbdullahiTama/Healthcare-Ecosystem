import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockSupabase = vi.hoisted(() => {
  const ctrl = { wallet: { user_id: 'sender1', balance: 50 }, rpcResult: { data: 'ok', error: null } }
  const query = () => {
    const q = {}
    q.select = vi.fn(() => q)
    q.eq = vi.fn(() => q)
    q.order = vi.fn(() => q)
    q.limit = vi.fn(() => q)
    q.single = vi.fn(() => q)
    q.maybeSingle = vi.fn(() => q)
    q.insert = vi.fn(() => q)
    q.update = vi.fn(() => q)
    q.delete = vi.fn(() => q)
    q.then = (resolve) => resolve({ data: ctrl.wallet, error: null })
    return q
  }
  return {
    ctrl,
    from: vi.fn(() => query()),
    rpc: vi.fn(() => Promise.resolve(ctrl.rpcResult)),
  }
})

vi.mock('../../config/supabaseClient', () => ({ supabase: mockSupabase }))
vi.mock('../../providers/AuthContext', () => ({ useAuth: () => ({ user: { id: 'sender1', email: 'a@b.c' } }) }))
vi.mock('../../services/notify.js', () => ({ notify: vi.fn() }))
vi.mock('../../components/ui', () => ({
  Toast: () => null,
  useToast: () => ({ msg: null, type: null, actionLabel: null, onAction: null, show: vi.fn() }),
}))

const supabase = (await import('../../config/supabaseClient')).supabase
const notify = (await import('../../services/notify.js')).notify

import GiftPanel from './GiftPanel.jsx'

function renderPanel({ postId = 'post1', recipientId = 'recipient1' } = {}) {
  return render(
    <MemoryRouter>
      <GiftPanel postId={postId} recipientId={recipientId} onClose={vi.fn()} />
    </MemoryRouter>
  )
}

describe('GiftPanel (Feature 7 — gifting)', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    mockSupabase.ctrl.wallet = { user_id: 'sender1', balance: 50 }
    mockSupabase.ctrl.rpcResult = { data: 'ok', error: null }
    notify.mockClear()
    supabase.rpc.mockClear()
  })

  it('sends the selected gift via the send_gift RPC with the correct args', async () => {
    renderPanel()
    const send = await screen.findByRole('button', { name: /send .*pill/i })
    fireEvent.click(send)
    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('send_gift', {
        p_recipient: 'recipient1',
        p_coins: 1,
        p_gift_type: 'Pill',
        p_gift_emoji: '💊',
        p_post_id: 'post1',
      })
    })
  })

  it('notifies the recipient after a successful gift', async () => {
    renderPanel()
    const send = await screen.findByRole('button', { name: /send .*pill/i })
    fireEvent.click(send)
    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({
        recipientId: 'recipient1',
        actorId: 'sender1',
        type: 'gift',
        postId: 'post1',
      }))
    })
  })

  it('does not notify when the gift fails', async () => {
    mockSupabase.ctrl.rpcResult = { data: null, error: { message: 'function not found' } }
    renderPanel()
    const send = await screen.findByRole('button', { name: /send .*pill/i })
    fireEvent.click(send)
    await new Promise((r) => setTimeout(r, 50))
    expect(notify).not.toHaveBeenCalled()
  })

  it('blocks sending when the wallet cannot cover the gift', async () => {
    mockSupabase.ctrl.wallet = { user_id: 'sender1', balance: 0 }
    renderPanel()
    const blocked = await screen.findByRole('button', { name: /not enough carecoins/i })
    expect(blocked.disabled).toBe(true)
    fireEvent.click(blocked)
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })
})
