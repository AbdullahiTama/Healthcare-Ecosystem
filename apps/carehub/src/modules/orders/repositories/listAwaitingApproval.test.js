import { describe, it, expect, vi } from 'vitest'
import { createOrderRepository } from './index.js'

// The Order approvals page (Field team) and the dashboard count ask the server for the orders waiting on this
// person, so a long order history is not downloaded to be filtered in the browser.
describe('listAwaitingApproval', () => {
  it('for the person tagged as approver: submitted orders tagged to them, newest first', async () => {
    const request = vi.fn(async () => [{ id: 'o1' }])
    const repo = createOrderRepository({ request })
    const rows = await repo.listAwaitingApproval('biz-1', { approverStaffId: 's1', isOwner: false })
    expect(request).toHaveBeenCalledWith('orders?business_id=eq.biz-1&status=eq.submitted&approver_staff_id=eq.s1&order=created_at.desc&select=*')
    expect(rows).toEqual([{ id: 'o1' }])
  })

  it('for the owner: every submitted order of the company (the owner may approve any)', async () => {
    const request = vi.fn(async () => [])
    const repo = createOrderRepository({ request })
    await repo.listAwaitingApproval('biz-1', { approverStaffId: null, isOwner: true })
    expect(request).toHaveBeenCalledWith('orders?business_id=eq.biz-1&status=eq.submitted&order=created_at.desc&select=*')
  })

  it('someone who is neither the owner nor a staff member approves nothing, and nothing is asked', async () => {
    const request = vi.fn()
    const repo = createOrderRepository({ request })
    expect(await repo.listAwaitingApproval('biz-1', { approverStaffId: null, isOwner: false })).toEqual([])
    expect(request).not.toHaveBeenCalled()
  })

  it('a missing business asks nothing', async () => {
    const request = vi.fn()
    const repo = createOrderRepository({ request })
    expect(await repo.listAwaitingApproval(null, { isOwner: true })).toEqual([])
    expect(request).not.toHaveBeenCalled()
  })
})
