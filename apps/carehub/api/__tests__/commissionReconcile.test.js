import { describe, it, expect, vi } from 'vitest'
import { reconcileCommissions } from '../_lib/commissionReconcile.js'

// The commission itself is made by the database (see apps/carefind/src/test/payments/commissionEngine.db.test.js).
// This job only repairs payments that predate the engine and reports inconsistencies.
const client = ({ created = 0, problems = [], backfillError = null, reconcileError = null } = {}) => {
  const calls = []
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args })
      if (name === 'backfill_missing_commissions') return { data: created, error: backfillError }
      if (name === 'reconcile_commissions') return { data: problems, error: reconcileError }
      throw new Error(`unexpected rpc ${name}`)
    },
  }
}

describe('reconcileCommissions', () => {
  it('backfills, then reconciles; a clean ledger reports nothing', async () => {
    const c = client({ created: 3 })
    expect(await reconcileCommissions(c)).toEqual({ created: 3, problems: 0, byKind: {}, errors: 0 })
    expect(c.calls.map((x) => x.name)).toEqual(['backfill_missing_commissions', 'reconcile_commissions'])
    expect(c.calls[0].args).toEqual({ p_limit: 500 })
  })

  it('reports and loudly logs every inconsistency, grouped by kind', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const c = client({ problems: [
      { kind: 'wrong_rate', payment_id: 'p1', business_id: 'b1', agent_id: 'a1', detail: 'rate 0.5 for referral_bonus' },
      { kind: 'wrong_rate', payment_id: 'p2', business_id: 'b2', agent_id: 'a1', detail: 'x' },
      { kind: 'double_program', payment_id: 'p3', business_id: 'b3', agent_id: 'a2', detail: 'y' },
    ] })
    const r = await reconcileCommissions(c)
    expect(r).toMatchObject({ problems: 3, byKind: { wrong_rate: 2, double_program: 1 } })
    expect(err).toHaveBeenCalledTimes(3)
    err.mockRestore()
  })

  it('a database error is thrown (the cron reports the run as failed), never swallowed', async () => {
    await expect(reconcileCommissions(client({ backfillError: { message: 'db down' } }))).rejects.toThrow('db down')
    await expect(reconcileCommissions(client({ reconcileError: { message: 'nope' } }))).rejects.toThrow('nope')
  })
})
