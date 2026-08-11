import { describe, it, expect, vi } from 'vitest'
import {
  NOTIFICATION_TYPES,
  DEFAULT_MESSAGES,
  createCareFindNotificationService,
  createCareHubNotificationService,
  CareHubNotificationRepository,
} from './index.js'

describe('notification type contracts', () => {
  it('defines the CareFind platform types', () => {
    expect(NOTIFICATION_TYPES.LIKE).toBe('like')
    expect(NOTIFICATION_TYPES.FOLLOW).toBe('follow')
    expect(NOTIFICATION_TYPES.LIVE).toBe('live')
    expect(NOTIFICATION_TYPES.PROFILE_VIEW).toBe('profile_view')
  })

  it('defines the CareHub business types', () => {
    expect(NOTIFICATION_TYPES.ORDER_CREATED).toBe('order_created')
    expect(NOTIFICATION_TYPES.WITHDRAWAL_REQUEST).toBe('withdrawal_request')
    expect(NOTIFICATION_TYPES.TASK_SUBMISSION).toBe('task_submission')
  })

  it('provides a default message for every notification type', () => {
    for (const [key, type] of Object.entries(NOTIFICATION_TYPES)) {
      expect(DEFAULT_MESSAGES[type], `DEFAULT_MESSAGES.${key}`).toBeTruthy()
    }
  })

  it('stays in sync with the per-platform message maps', async () => {
    const { careFindMessages } = await import('./adapters/CareFindAdapter.js')
    const { careHubMessages } = await import('./adapters/CareHubAdapter.js')
    for (const [key, type] of Object.entries(NOTIFICATION_TYPES)) {
      const anywhere = careFindMessages[type] || careHubMessages[type]
      expect(anywhere, `type ${key} should be known to at least one adapter`).toBeTruthy()
    }
  })
})

describe('notification service rules', () => {
  function fakeRepo() {
    const repo = {
      create: vi.fn(async (payload) => ({ ...payload, id: 'n1' })),
      getByRecipient: vi.fn(async () => []),
      getUnreadCount: vi.fn(async () => 0),
      markAsRead: vi.fn(async () => {}),
      markAllAsRead: vi.fn(async () => {}),
      subscribe: vi.fn(() => () => {}),
    }
    return repo
  }

  it('notify writes the payload to the repository', async () => {
    const repo = fakeRepo()
    const service = createCareFindNotificationService(repo)
    await service.notify({ recipientId: 'r1', actorId: 'a1', type: NOTIFICATION_TYPES.LIKE })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: 'r1', actorId: 'a1', type: 'like' })
    )
  })

  it('notify fills in the default message when none is given', async () => {
    const repo = fakeRepo()
    const service = createCareFindNotificationService(repo)
    await service.notify({ recipientId: 'r1', actorId: 'a1', type: NOTIFICATION_TYPES.LIKE })
    const payload = repo.create.mock.calls[0][0]
    expect(payload.message).toBe('liked your post')
  })

  it('keeps a caller-supplied message instead of the default', async () => {
    const repo = fakeRepo()
    const service = createCareFindNotificationService(repo)
    await service.notify({ recipientId: 'r1', actorId: 'a1', type: NOTIFICATION_TYPES.LIKE, message: 'custom' })
    expect(repo.create.mock.calls[0][0].message).toBe('custom')
  })

  it('notify swallows repository errors so notifications never break the action', async () => {
    const repo = fakeRepo()
    repo.create = vi.fn(async () => { throw new Error('db down') })
    const service = createCareFindNotificationService(repo)
    await expect(service.notify({ recipientId: 'r1', actorId: 'a1', type: NOTIFICATION_TYPES.LIKE })).resolves.toBeUndefined()
  })

  it('delegates reads and writes straight to the repository', async () => {
    const repo = fakeRepo()
    const service = createCareHubNotificationService(repo)
    await service.getNotifications('r1', { limit: 10 })
    expect(repo.getByRecipient).toHaveBeenCalledWith('r1', { limit: 10 })
    await service.markAsRead('n1')
    expect(repo.markAsRead).toHaveBeenCalledWith('n1')
  })
})

describe('CareHubNotificationRepository.mapToStandard', () => {
  it('maps a staff_notifications row to the shared shape', () => {
    const repo = new CareHubNotificationRepository()
    const row = {
      id: 'n1',
      staff_id: 's1',
      kind: 'order_created',
      title: 'created a new order',
      link: '/orders/1',
      read_at: '2026-08-01T10:00:00Z',
      created_at: '2026-08-01T09:00:00Z',
    }
    expect(repo.mapToStandard(row)).toEqual({
      id: 'n1',
      recipient_id: 's1',
      actor_id: null,
      type: 'order_created',
      message: 'created a new order',
      link: '/orders/1',
      post_id: null,
      read: true,
      created_at: '2026-08-01T09:00:00Z',
    })
  })

  it('reports unread rows when read_at is null', () => {
    const repo = new CareHubNotificationRepository()
    const mapped = repo.mapToStandard({ id: 'n1', staff_id: 's1', kind: 'x', title: 'y', link: null, read_at: null, created_at: '2026-08-01T09:00:00Z' })
    expect(mapped.read).toBe(false)
  })
})