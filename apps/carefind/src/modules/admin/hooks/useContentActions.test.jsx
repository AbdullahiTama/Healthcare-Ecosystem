import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const callAdminAuth = vi.hoisted(() => vi.fn())
const uploadToBucket = vi.hoisted(() => vi.fn())
const admin = vi.hoisted(() => ({ showToast: vi.fn(), invalidateAdmin: vi.fn(), recordAction: vi.fn() }))
vi.mock('../adminApi', () => ({ callAdminAuth }))
vi.mock('../lib/uploadMedia', () => ({ uploadToBucket }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import { useContentActions } from './useContentActions'

const run = async (fn) => { let out; await act(async () => { out = await fn() }); return out }
const calledActions = () => callAdminAuth.mock.calls.map(c => c[0])
const file = { name: 'a.png' }
beforeEach(() => {
  callAdminAuth.mockReset().mockResolvedValue({})
  uploadToBucket.mockReset().mockImplementation(async (_bucket, f) => (f ? { ok: true, url: 'https://cdn/x.png' } : { ok: true, url: null }))
  Object.values(admin).forEach(f => { f.mockReset() })
})

describe('useContentActions: stories', () => {
  it('refuses an empty story without any call', async () => {
    const { result } = renderHook(() => useContentActions())
    const out = await run(() => result.current.createStory({ title: '  ', body: ' ', bgColor: 'red', imageFile: null }))
    expect(out).toEqual({ ok: false, error: 'Add a title, a message or an image' })
    expect(uploadToBucket).not.toHaveBeenCalled()
    expect(callAdminAuth).not.toHaveBeenCalled()
  })

  it('creates a text story with null image and null blank title', async () => {
    const { result } = renderHook(() => useContentActions())
    const out = await run(() => result.current.createStory({ title: '  ', body: ' Hello ', bgColor: 'var(--color-primary)', imageFile: null }))
    expect(out).toEqual({ ok: true })
    expect(callAdminAuth).toHaveBeenCalledWith('create_story', { title: null, body: 'Hello', imageUrl: null, bgColor: 'var(--color-primary)' })
    expect(admin.invalidateAdmin).toHaveBeenCalledTimes(1)
    expect(admin.showToast).toHaveBeenCalledWith('Story published', { type: 'success' })
  })

  it('uploads the image to story-images with the story prefix', async () => {
    const { result } = renderHook(() => useContentActions())
    await run(() => result.current.createStory({ title: ' T ', body: '', bgColor: 'blue', imageFile: file }))
    expect(uploadToBucket).toHaveBeenCalledWith('story-images', file, 'story')
    expect(callAdminAuth).toHaveBeenCalledWith('create_story', { title: 'T', body: null, imageUrl: 'https://cdn/x.png', bgColor: 'blue' })
  })

  it('stops on a failed upload and never calls create_story', async () => {
    uploadToBucket.mockResolvedValue({ ok: false, error: 'bucket full' })
    const { result } = renderHook(() => useContentActions())
    const out = await run(() => result.current.createStory({ title: 'T', body: 'B', bgColor: 'x', imageFile: file }))
    expect(out).toEqual({ ok: false, error: "Couldn't upload the image: bucket full" })
    expect(calledActions()).not.toContain('create_story')
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
    expect(admin.showToast).not.toHaveBeenCalled()
  })

  it('deletes a story', async () => {
    const { result } = renderHook(() => useContentActions())
    const out = await run(() => result.current.deleteStory('s1'))
    expect(out).toEqual({ ok: true })
    expect(callAdminAuth).toHaveBeenCalledWith('delete_story', { id: 's1' })
    expect(admin.invalidateAdmin).toHaveBeenCalledTimes(1)
    expect(admin.showToast).toHaveBeenCalledWith('Story deleted', { type: 'success' })
  })

  it('returns the server error without toasting or refreshing', async () => {
    callAdminAuth.mockRejectedValueOnce(new Error('Not allowed'))
    const { result } = renderHook(() => useContentActions())
    const out = await run(() => result.current.createStory({ title: 'T', body: '', bgColor: 'x', imageFile: null }))
    expect(out).toEqual({ ok: false, error: 'Not allowed' })
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
    expect(admin.showToast).not.toHaveBeenCalled()
  })
})

describe('useContentActions: promotions', () => {
  it('refuses a blank title without any call', async () => {
    const { result } = renderHook(() => useContentActions())
    const out = await run(() => result.current.createPromotion({ title: '   ', linkUrl: '', days: '7', imageFile: file }))
    expect(out).toEqual({ ok: false, error: 'Add a title' })
    expect(uploadToBucket).not.toHaveBeenCalled()
    expect(callAdminAuth).not.toHaveBeenCalled()
  })

  it('creates with trimmed fields, null blank link and the days string', async () => {
    const { result } = renderHook(() => useContentActions())
    const out = await run(() => result.current.createPromotion({ title: ' Sale ', linkUrl: '  ', days: '7', imageFile: null }))
    expect(out).toEqual({ ok: true })
    expect(callAdminAuth).toHaveBeenCalledWith('create_promotion', { title: 'Sale', linkUrl: null, imageUrl: null, days: '7' })
    expect(admin.invalidateAdmin).toHaveBeenCalledTimes(1)
    expect(admin.showToast).toHaveBeenCalledWith('Promotion created', { type: 'success' })
  })

  it('uploads to promo-images with the promo prefix and passes the link', async () => {
    const { result } = renderHook(() => useContentActions())
    await run(() => result.current.createPromotion({ title: 'Sale', linkUrl: ' https://x.test ', days: '14', imageFile: file }))
    expect(uploadToBucket).toHaveBeenCalledWith('promo-images', file, 'promo')
    expect(callAdminAuth).toHaveBeenCalledWith('create_promotion', { title: 'Sale', linkUrl: 'https://x.test', imageUrl: 'https://cdn/x.png', days: '14' })
  })

  it('stops on a failed upload and never calls create_promotion', async () => {
    uploadToBucket.mockResolvedValue({ ok: false, error: 'too big' })
    const { result } = renderHook(() => useContentActions())
    const out = await run(() => result.current.createPromotion({ title: 'Sale', linkUrl: '', days: '7', imageFile: file }))
    expect(out).toEqual({ ok: false, error: "Couldn't upload the image: too big" })
    expect(calledActions()).not.toContain('create_promotion')
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
    expect(admin.showToast).not.toHaveBeenCalled()
  })

  it('deletes a promotion', async () => {
    const { result } = renderHook(() => useContentActions())
    const out = await run(() => result.current.deletePromotion('p1'))
    expect(out).toEqual({ ok: true })
    expect(callAdminAuth).toHaveBeenCalledWith('delete_promotion', { id: 'p1' })
    expect(admin.invalidateAdmin).toHaveBeenCalledTimes(1)
    expect(admin.showToast).toHaveBeenCalledWith('Promotion deleted', { type: 'success' })
  })

  it('returns the server error without toasting or refreshing', async () => {
    callAdminAuth.mockRejectedValueOnce(new Error('Nope'))
    const { result } = renderHook(() => useContentActions())
    const out = await run(() => result.current.deletePromotion('p1'))
    expect(out).toEqual({ ok: false, error: 'Nope' })
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
    expect(admin.showToast).not.toHaveBeenCalled()
  })

  it('a throwing refresh after success still resolves ok', async () => {
    admin.invalidateAdmin.mockImplementation(() => { throw new Error('refresh broke') })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useContentActions())
    const out = await run(() => result.current.deleteStory('s1'))
    expect(out).toEqual({ ok: true })
    // The toast runs after the refresh and is not lost when the refresh throws.
    expect(admin.showToast).toHaveBeenCalledWith('Story deleted', { type: 'success' })
    spy.mockRestore()
  })
})

// Legacy wrote no audit entry and no action-history entry for stories or
// promotions; these pin that, so adding one is a deliberate change.
describe('useContentActions: no audit or action history', () => {
  it.each([
    ['createStory', { title: 'T', body: 'B', bgColor: 'x', imageFile: file }, 'create_story'],
    ['deleteStory', 's1', 'delete_story'],
    ['createPromotion', { title: 'Sale', linkUrl: '', days: '7', imageFile: file }, 'create_promotion'],
    ['deletePromotion', 'p1', 'delete_promotion'],
  ])('%s calls only its own action: no log_audit_action and no recordAction', async (name, arg, action) => {
    const { result } = renderHook(() => useContentActions())
    const out = await run(() => result.current[name](arg))
    expect(out).toEqual({ ok: true })
    expect(calledActions()).toEqual([action])
    expect(calledActions()).not.toContain('log_audit_action')
    expect(admin.recordAction).not.toHaveBeenCalled()
  })
})

describe('useContentActions: busy', () => {
  it('is true while a create runs, including the upload, and clears afterwards', async () => {
    let release
    uploadToBucket.mockImplementation(() => new Promise(r => { release = r }))
    const { result } = renderHook(() => useContentActions())
    expect(result.current.busy).toBe(false)
    let pending
    act(() => { pending = result.current.createStory({ title: 'T', body: '', bgColor: 'x', imageFile: file }) })
    expect(result.current.busy).toBe(true)
    await act(async () => { release({ ok: true, url: 'u' }); await pending })
    expect(result.current.busy).toBe(false)
  })

  it('clears after a failed delete', async () => {
    let release
    callAdminAuth.mockImplementation(() => new Promise((_, rej) => { release = rej }))
    const { result } = renderHook(() => useContentActions())
    let pending
    act(() => { pending = result.current.deleteStory('s1') })
    expect(result.current.busy).toBe(true)
    await act(async () => { release(new Error('x')); await pending })
    expect(result.current.busy).toBe(false)
  })
})
