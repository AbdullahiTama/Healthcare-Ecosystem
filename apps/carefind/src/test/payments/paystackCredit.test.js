import { describe, it, expect, vi, beforeEach } from 'vitest'

// The shared creditTopup function extracted from paystackCredit.js
async function creditTopup(supabase, { userId, coins, nairaAmount, reference }) {
  const { data, error } = await supabase.rpc('credit_wallet_topup', {
    p_user_id: userId,
    p_coins: coins,
    p_naira_amount: nairaAmount,
    p_reference: reference,
  })

  if (error) throw error

  const row = Array.isArray(data) ? data[0] : data
  return { alreadyProcessed: row.already_processed, newBalance: row.new_balance }
}

describe('creditTopup', () => {
  let mockSupabase

  beforeEach(() => {
    mockSupabase = {
      rpc: vi.fn(),
    }
  })

  it('credits a new topup successfully', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: [{ already_processed: false, new_balance: 50 }],
      error: null,
    })

    const result = await creditTopup(mockSupabase, {
      userId: 'user-1',
      coins: 50,
      nairaAmount: 850000,
      reference: 'cf_test_ref',
    })

    expect(mockSupabase.rpc).toHaveBeenCalledWith('credit_wallet_topup', {
      p_user_id: 'user-1',
      p_coins: 50,
      p_naira_amount: 850000,
      p_reference: 'cf_test_ref',
    })
    expect(result).toEqual({ alreadyProcessed: false, newBalance: 50 })
  })

  it('returns alreadyProcessed for duplicate reference', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: [{ already_processed: true, new_balance: 25 }],
      error: null,
    })

    const result = await creditTopup(mockSupabase, {
      userId: 'user-1',
      coins: 50,
      nairaAmount: 850000,
      reference: 'cf_dup_ref',
    })

    expect(result.alreadyProcessed).toBe(true)
    expect(result.newBalance).toBe(25)
  })

  it('throws on RPC error', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: new Error('Database error'),
    })

    await expect(creditTopup(mockSupabase, {
      userId: 'user-1',
      coins: 5,
      nairaAmount: 95000,
      reference: 'cf_err_ref',
    })).rejects.toThrow('Database error')
  })

  it('handles array data wrapper', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: [{ already_processed: false, new_balance: 15 }],
      error: null,
    })

    const result = await creditTopup(mockSupabase, {
      userId: 'user-1',
      coins: 15,
      nairaAmount: 270000,
      reference: 'cf_arr_ref',
    })

    expect(result.newBalance).toBe(15)
  })
})